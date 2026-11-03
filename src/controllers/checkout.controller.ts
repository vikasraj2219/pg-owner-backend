import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import {
  Tenant,
  Bed,
  BedAssignment,
  Invoice,
  DepositLedger,
  SettlementStatement,
} from '../models';
import { checkoutConfirmSchema } from '../validators/checkout.validator';
import { generateSettlementNumber } from '../services/settlementNumber.service';

/**
 * Preview settlement calculations for a vacating tenant
 * GET /api/checkouts/preview/:tenantId
 */
export const getCheckoutPreview = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const orgId = req.orgId;

    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    const tenant = await Tenant.findOne({ _id: tenantId, organization: orgId })
      .populate('property', 'name code upiVpa')
      .populate('currentBed', 'bedNumber room status');

    if (!tenant) {
      throw new AppError('Tenant not found or does not belong to your organization', 404);
    }

    // Active assignment
    const activeAssignment = await BedAssignment.findOne({
      tenant: tenant._id,
      organization: orgId,
      status: 'active',
    })
      .populate('room', 'roomNumber floorNumber')
      .populate('bed', 'bedNumber');

    // Fetch unpaid invoices
    const unpaidInvoices = await Invoice.find({
      tenant: tenant._id,
      organization: orgId,
      status: { $in: ['unpaid', 'partially_paid', 'overdue'] },
    }).sort({ dueDate: 1 });

    const unpaidDuesPaise = unpaidInvoices.reduce((sum, inv) => sum + inv.balanceDuePaise, 0);
    const depositPaidPaise = tenant.depositPaidPaise || tenant.depositPaise || 0;
    const netRefundPaise = Math.max(0, depositPaidPaise - unpaidDuesPaise);

    res.status(200).json({
      success: true,
      data: {
        tenant: {
          _id: tenant._id,
          fullName: tenant.fullName,
          phone: tenant.phone,
          status: tenant.status,
          joinedDate: tenant.createdAt,
          property: tenant.property,
          currentBed: tenant.currentBed,
          room: activeAssignment?.room,
        },
        depositPaidPaise,
        unpaidInvoices: unpaidInvoices.map(inv => ({
          _id: inv._id,
          invoiceNumber: inv.invoiceNumber,
          month: inv.month,
          year: inv.year,
          totalAmountPaise: inv.totalAmountPaise,
          amountPaidPaise: inv.amountPaidPaise,
          balanceDuePaise: inv.balanceDuePaise,
          dueDate: inv.dueDate,
          status: inv.status,
        })),
        unpaidDuesPaise,
        estimatedRefundPaise: netRefundPaise,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Confirm checkout & settlement in an atomic transaction
 * POST /api/checkouts/confirm
 */
export const confirmCheckout = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const orgId = req.orgId;
    const userId = req.user?.id;

    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    const validated = checkoutConfirmSchema.parse(req.body);
    const {
      tenantId,
      damageDeductionsPaise,
      electricityDeductionsPaise,
      otherDeductionsPaise,
      paymentMethod,
      transactionReference,
      notes,
    } = validated;

    const tenant = await Tenant.findOne({ _id: tenantId, organization: orgId }).session(session);
    if (!tenant) {
      throw new AppError('Tenant not found or does not belong to your organization', 404);
    }

    if (tenant.status === 'checked_out') {
      throw new AppError('Tenant is already checked out', 400);
    }

    // Unpaid invoices
    const unpaidInvoices = await Invoice.find({
      tenant: tenant._id,
      organization: orgId,
      status: { $in: ['unpaid', 'partially_paid', 'overdue'] },
    }).session(session);

    const unpaidDuesPaise = unpaidInvoices.reduce((sum, inv) => sum + inv.balanceDuePaise, 0);
    const depositPaidPaise = tenant.depositPaidPaise || tenant.depositPaise || 0;

    const totalDeductionsPaise =
      unpaidDuesPaise + damageDeductionsPaise + electricityDeductionsPaise + otherDeductionsPaise;

    const calculatedRefundPaise = Math.max(0, depositPaidPaise - totalDeductionsPaise);
    const netRefundPaise =
      validated.refundPaise !== undefined ? validated.refundPaise : calculatedRefundPaise;

    // 1. Release Bed
    let freedBedId: mongoose.Types.ObjectId | undefined = undefined;
    let freedRoomId: mongoose.Types.ObjectId | undefined = undefined;

    if (tenant.currentBed) {
      const bed = await Bed.findOne({ _id: tenant.currentBed, organization: orgId }).session(
        session,
      );
      if (bed) {
        freedBedId = bed._id;
        freedRoomId = bed.room;
        bed.status = 'available';
        bed.currentTenant = undefined;
        bed.noticeEndDate = undefined;
        bed.maintenanceNote = undefined;
        await bed.save({ session });
      }
    }

    // 2. Close active BedAssignment
    await BedAssignment.updateMany(
      { tenant: tenant._id, organization: orgId, status: 'active' },
      { $set: { status: 'vacated', endDate: new Date(), notes: notes || 'Checkout completed' } },
      { session },
    );

    // 3. Generate sequential settlement number
    const settlementNumber = await generateSettlementNumber(orgId);

    // 4. Create Settlement Statement
    const [settlement] = await SettlementStatement.create(
      [
        {
          organization: orgId,
          property: tenant.property,
          tenant: tenant._id,
          bed: freedBedId,
          room: freedRoomId,
          settlementNumber,
          checkinDate: tenant.createdAt,
          checkoutDate: new Date(),
          depositPaidPaise,
          unpaidDuesPaise,
          damageDeductionsPaise,
          electricityDeductionsPaise,
          otherDeductionsPaise,
          totalDeductionsPaise,
          netRefundPaise,
          paymentMethod,
          transactionReference,
          notes,
          recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
        },
      ],
      { session },
    );

    // 5. Record DepositLedger entries
    if (netRefundPaise > 0) {
      await DepositLedger.create(
        [
          {
            organization: orgId,
            property: tenant.property,
            tenant: tenant._id,
            amountPaise: netRefundPaise,
            type: 'refunded',
            paymentMethod,
            notes: `Checkout refund [${settlementNumber}]: ${notes || 'Deposit refund'}`,
            recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
            date: new Date(),
          },
        ],
        { session },
      );
    }

    const totalNonDuesDeduction =
      damageDeductionsPaise + electricityDeductionsPaise + otherDeductionsPaise;
    if (totalNonDuesDeduction > 0) {
      await DepositLedger.create(
        [
          {
            organization: orgId,
            property: tenant.property,
            tenant: tenant._id,
            amountPaise: totalNonDuesDeduction,
            type: 'deducted',
            paymentMethod,
            notes: `Checkout deductions [${settlementNumber}] (Damage: ${damageDeductionsPaise}, EB: ${electricityDeductionsPaise}, Other: ${otherDeductionsPaise})`,
            recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
            date: new Date(),
          },
        ],
        { session },
      );
    }

    // 6. Mark unpaid invoices as settled if covered by deposit
    for (const inv of unpaidInvoices) {
      inv.amountPaidPaise = inv.totalAmountPaise;
      inv.balanceDuePaise = 0;
      inv.status = 'paid';
      await inv.save({ session });
    }

    // 7. Update tenant
    tenant.status = 'checked_out';
    tenant.currentBed = undefined;
    await tenant.save({ session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: `Tenant ${tenant.fullName} successfully vacated and settlement generated.`,
      data: {
        settlement,
        tenantId: tenant._id,
        status: tenant.status,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * List settlement statements
 * GET /api/checkouts/statements
 */
export const getSettlementStatements = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }
    const { propertyId } = req.query;

    const query: Record<string, unknown> = { organization: orgId };
    if (propertyId && typeof propertyId === 'string' && mongoose.Types.ObjectId.isValid(propertyId)) {
      query.property = propertyId;
    }

    const statements = await SettlementStatement.find(query)
      .populate('tenant', 'fullName phone')
      .populate('property', 'name code')
      .populate('bed', 'bedNumber')
      .sort({ checkoutDate: -1 });

    res.status(200).json({
      success: true,
      data: statements,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single settlement statement details
 * GET /api/checkouts/statements/:id
 */
export const getSettlementStatementById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid settlement statement ID', 400);
    }

    const statement = await SettlementStatement.findOne({ _id: id, organization: orgId })
      .populate('tenant', 'fullName phone email kycData')
      .populate('property', 'name code address upiVpa')
      .populate('bed', 'bedNumber')
      .populate('room', 'roomNumber floorNumber')
      .populate('recordedBy', 'name');

    if (!statement) {
      throw new AppError('Settlement statement not found', 404);
    }

    res.status(200).json({
      success: true,
      data: statement,
    });
  } catch (error) {
    next(error);
  }
};
