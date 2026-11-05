import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { quickCheckinSchema } from '../validators/checkin.validator';
import { Property } from '../models/Property';
import { Bed } from '../models/Bed';
import { Tenant } from '../models/Tenant';
import { BedAssignment } from '../models/BedAssignment';
import { Invoice } from '../models/Invoice';
import { DepositLedger } from '../models/DepositLedger';
import { Organization } from '../models/Organization';
import { Subscription } from '../models/Subscription';
import { calculateProratedRent } from '../services/proration.service';
import { generateInvoiceNumber } from '../services/invoiceNumber.service';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const quickCheckin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = quickCheckinSchema.parse(req.body);
    const orgId = req.orgId;
    const userId = req.user?.id;

    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    // 1. Verify Property belongs to organization
    if (!mongoose.Types.ObjectId.isValid(input.propertyId)) {
      throw new AppError('Invalid property ID format', 400);
    }
    const property = await Property.findOne({
      _id: input.propertyId,
      organization: orgId,
    });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    // 2. Verify Bed belongs to organization and property, and is available
    if (!mongoose.Types.ObjectId.isValid(input.bedId)) {
      throw new AppError('Invalid bed ID format', 400);
    }
    const bed = await Bed.findOne({
      _id: input.bedId,
      property: property._id,
      organization: orgId,
    }).populate('room');

    if (!bed) {
      throw new AppError('Bed not found or does not belong to specified property', 404);
    }

    if (bed.status !== 'available') {
      throw new AppError(
        `Bed ${bed.bedNumber} is currently ${bed.status}. Only available beds can be checked into.`,
        400,
      );
    }

    // 3. Verify Subscription Capacity / Quota
    const sub = await Subscription.findOne({ organization: orgId });
    if (sub) {
      const occupiedBedsCount = await Bed.countDocuments({
        organization: orgId,
        status: { $in: ['occupied', 'notice_period'] },
      });
      if (occupiedBedsCount >= sub.maxBeds) {
        throw new AppError(
          `Subscription limit reached: Your ${sub.plan} plan supports up to ${sub.maxBeds} active tenants. You currently have ${occupiedBedsCount} active tenants. Please upgrade to check in additional tenants.`,
          403,
        );
      }
    }

    // 4. Prepare Dates and Proration
    const joinDateObj = new Date(input.joinDate);
    const proration = calculateProratedRent(input.monthlyRentPaise, joinDateObj);
    const monthName = MONTH_NAMES[proration.month - 1];

    // Calculate invoice due date based on organization settings
    const org = await Organization.findById(orgId);
    const dueDay = org?.settings?.rentDueDay || 5;
    const dueDate = new Date(proration.year, proration.month - 1, dueDay);
    // If due date has passed in the current month, set due date 3 days from join date
    if (dueDate.getTime() < joinDateObj.getTime()) {
      dueDate.setTime(joinDateObj.getTime() + 3 * 24 * 60 * 60 * 1000);
    }

    // Generate unique invoice number
    const invoiceNumber = await generateInvoiceNumber(
      orgId.toString(),
      proration.year,
      proration.month,
    );

    // 4. Run single transaction check-in
    let session: mongoose.ClientSession | null = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (_sessionErr) {
      session = null;
    }

    try {
      const sessionOpts = session ? { session } : {};

      // A. Create Tenant
      const createdTenants = await Tenant.create(
        [
          {
            organization: orgId,
            property: property._id,
            currentBed: bed._id,
            fullName: input.fullName.trim(),
            phone: input.phone.trim(),
            emergencyPhone: input.emergencyPhone ? input.emergencyPhone.trim() : undefined,
            monthlyRentPaise: input.monthlyRentPaise,
            depositPaise: input.depositPaise,
            depositPaidPaise: input.depositPaidPaise,
            kycDocType: input.kycDocType,
            kycMaskedNumber: input.kycMaskedNumber ? input.kycMaskedNumber.trim() : undefined,
            kycDocUrl: input.kycDocUrl ? input.kycDocUrl.trim() : undefined,
            kycConsent: input.kycConsent,
            status: 'active',
          },
        ],
        sessionOpts,
      );

      const tenant = createdTenants[0];
      if (!tenant) {
        throw new AppError('Failed to initialize tenant record', 500);
      }

      // B. Update Bed: Mark as occupied
      bed.status = 'occupied';
      bed.currentTenant = tenant._id as mongoose.Types.ObjectId;
      bed.maintenanceNote = undefined;
      bed.noticeEndDate = undefined;
      await bed.save(sessionOpts);

      // C. Create BedAssignment (Historical record)
      await BedAssignment.create(
        [
          {
            organization: orgId,
            property: property._id,
            room: bed.room,
            bed: bed._id,
            tenant: tenant._id,
            startDate: joinDateObj,
            status: 'active',
            monthlyRentPaise: input.monthlyRentPaise,
            notes: `Checked in on ${joinDateObj.toLocaleDateString('en-IN')}`,
          },
        ],
        sessionOpts,
      );

      // D. Record Security Deposit in DepositLedger if depositPaidPaise > 0
      let depositRecord = null;
      if (input.depositPaidPaise > 0) {
        const createdDeposits = await DepositLedger.create(
          [
            {
              organization: orgId,
              property: property._id,
              tenant: tenant._id,
              amountPaise: input.depositPaidPaise,
              type: 'received',
              paymentMethod: input.depositPaymentMethod,
              transactionRef: input.depositTransactionRef,
              notes: 'Initial security deposit collected at check-in',
              recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
              date: joinDateObj,
            },
          ],
          sessionOpts,
        );
        depositRecord = createdDeposits[0];
      }

      // E. Generate First Prorated Rent Invoice
      const rentDescription = proration.isProrated
        ? `Prorated Rent (${proration.billableDays} days: ${proration.joinDay} to ${proration.totalDays} ${monthName})`
        : `Full Month Rent (${monthName} ${proration.year})`;

      const createdInvoices = await Invoice.create(
        [
          {
            organization: orgId,
            property: property._id,
            tenant: tenant._id,
            invoiceNumber,
            month: proration.month,
            year: proration.year,
            dueDate,
            items: [
              {
                description: rentDescription,
                amountPaise: proration.payablePaise,
                category: 'rent',
              },
            ],
            totalAmountPaise: proration.payablePaise,
            amountPaidPaise: 0,
            balanceDuePaise: proration.payablePaise,
            status: 'unpaid',
          },
        ],
        sessionOpts,
      );

      const invoice = createdInvoices[0];

      // Commit transaction
      if (session) {
        await session.commitTransaction();
      }

      res.status(201).json({
        success: true,
        message: `Tenant ${tenant.fullName} successfully checked into Bed ${bed.bedNumber}`,
        data: {
          tenant,
          bed: {
            _id: bed._id,
            bedNumber: bed.bedNumber,
            status: bed.status,
          },
          invoice,
          deposit: depositRecord,
          proration,
        },
      });
    } catch (txError) {
      if (session && session.inTransaction()) {
        await session.abortTransaction();
      }
      throw txError;
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  } catch (error) {
    next(error);
  }
};
