import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice';
import { Payment } from '../models/Payment';
import { Organization } from '../models/Organization';
import { BedAssignment } from '../models/BedAssignment';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';
import { generateInvoiceNumber } from '../services/invoiceNumber.service';
import { generateReceiptNumber } from '../services/receiptNumber.service';
import { generateMonthlyInvoicesSchema, markPaidSchema } from '../validators/invoice.validator';
import { env } from '../config/env';

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

/**
 * GET /api/invoices
 * List invoices with flexible filtering and overdue calculation scoped by organization
 */
export const getInvoices = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    const org = await Organization.findById(orgId).select('settings');
    const gracePeriodDays = org?.settings?.gracePeriodDays ?? 5;

    const filter: Record<string, unknown> = { organization: orgId };

    if (req.query.propertyId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.propertyId as string)) {
        throw new AppError('Invalid property ID format', 400);
      }
      filter.property = req.query.propertyId;
    }

    if (req.query.tenantId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.tenantId as string)) {
        throw new AppError('Invalid tenant ID format', 400);
      }
      filter.tenant = req.query.tenantId;
    }

    if (req.query.month) {
      filter.month = parseInt(req.query.month as string, 10);
    }

    if (req.query.year) {
      filter.year = parseInt(req.query.year as string, 10);
    }

    const statusParam = req.query.status as string | undefined;
    const now = new Date();

    if (statusParam === 'overdue') {
      filter.status = { $in: ['unpaid', 'partially_paid'] };
      // Due date + grace period has passed
      const overdueCutoff = new Date(now.getTime() - gracePeriodDays * 24 * 60 * 60 * 1000);
      filter.dueDate = { $lt: overdueCutoff };
    } else if (statusParam === 'unpaid') {
      filter.status = { $in: ['unpaid', 'partially_paid'] };
    } else if (statusParam === 'paid') {
      filter.status = 'paid';
    }

    const invoices = await Invoice.find(filter)
      .populate('tenant', 'fullName phone currentBed status')
      .populate('property', 'name type address upiVpa')
      .sort({ dueDate: -1, createdAt: -1 });

    const search = (req.query.search as string | undefined)?.toLowerCase().trim();

    const formattedInvoices = invoices
      .map(inv => {
        const invObj = inv.toObject();
        const dueDate = new Date(inv.dueDate);
        const diffTime = now.getTime() - dueDate.getTime();
        const daysPastDue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        const isOverdue = inv.status !== 'paid' && daysPastDue > gracePeriodDays;
        const overdueDays = inv.status !== 'paid' && daysPastDue > 0 ? daysPastDue : 0;

        return {
          ...invObj,
          overdueDays,
          isOverdue,
        };
      })
      .filter(inv => {
        if (!search) return true;
        const tenantName = (inv.tenant as { fullName?: string })?.fullName?.toLowerCase() || '';
        const invNum = inv.invoiceNumber?.toLowerCase() || '';
        return tenantName.includes(search) || invNum.includes(search);
      });

    res.status(200).json({
      success: true,
      count: formattedInvoices.length,
      data: formattedInvoices,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/invoices/:id
 * Retrieve single invoice details with its payment history
 */
export const getInvoiceById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid invoice ID format', 400);
    }

    const invoice = await Invoice.findOne({ _id: id, organization: orgId })
      .populate('tenant', 'fullName phone currentBed status')
      .populate('property', 'name type address upiVpa');

    if (!invoice) {
      throw new AppError('Invoice not found or does not belong to your organization', 404);
    }

    const payments = await Payment.find({ invoice: invoice._id, organization: orgId }).sort({
      paymentDate: -1,
    });

    res.status(200).json({
      success: true,
      data: {
        ...invoice.toObject(),
        payments,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/invoices/generate-monthly
 * Idempotent monthly billing cron / trigger
 * Protected by x-cron-secret header OR authenticated organization session
 */
export const generateMonthlyInvoices = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const cronSecret = req.headers['x-cron-secret'];
    const authReq = req as AuthenticatedRequest;
    const hasValidCronSecret = cronSecret && cronSecret === env.INTERNAL_CRON_SECRET;
    const orgId = authReq.orgId;

    if (!hasValidCronSecret && !orgId) {
      throw new AppError(
        'Unauthorized: valid cron secret or organization authentication required',
        401,
      );
    }

    const parsed = generateMonthlyInvoicesSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.errors[0]?.message || 'Invalid monthly invoice parameters',
        400,
      );
    }

    const now = new Date();
    const targetMonth = parsed.data.month ?? now.getMonth() + 1;
    const targetYear = parsed.data.year ?? now.getFullYear();
    const filterPropertyId = parsed.data.propertyId;

    // Determine target organizations
    let targetOrgIds: mongoose.Types.ObjectId[] = [];

    if (orgId) {
      targetOrgIds = [new mongoose.Types.ObjectId(orgId)];
    } else if (req.body.organizationId) {
      if (!mongoose.Types.ObjectId.isValid(req.body.organizationId)) {
        throw new AppError('Invalid organizationId format', 400);
      }
      targetOrgIds = [new mongoose.Types.ObjectId(req.body.organizationId)];
    } else {
      const allOrgs = await Organization.find().select('_id');
      targetOrgIds = allOrgs.map(o => o._id as mongoose.Types.ObjectId);
    }

    let generatedCount = 0;
    let skippedCount = 0;
    const monthName = `${MONTH_NAMES[targetMonth - 1]} ${targetYear}`;

    for (const targetId of targetOrgIds) {
      const org = await Organization.findById(targetId);
      if (!org) continue;

      const rentDueDay = Math.min(28, Math.max(1, org.settings?.rentDueDay ?? 1));
      const dueDate = new Date(targetYear, targetMonth - 1, rentDueDay, 23, 59, 59, 999);

      const assignmentFilter: Record<string, unknown> = {
        organization: targetId,
        status: 'active',
      };
      if (filterPropertyId) {
        assignmentFilter.property = filterPropertyId;
      }

      const activeAssignments = await BedAssignment.find(assignmentFilter).populate(
        'tenant',
        'fullName status',
      );

      for (const assignment of activeAssignments) {
        if (!assignment.tenant) continue;
        const tenantId = (assignment.tenant as { _id: mongoose.Types.ObjectId })._id;

        // Idempotency check: see if invoice already exists for this tenant in this month/year
        const existingInvoice = await Invoice.findOne({
          tenant: tenantId,
          month: targetMonth,
          year: targetYear,
        });

        if (existingInvoice) {
          skippedCount++;
          continue;
        }

        const invoiceNumber = await generateInvoiceNumber(
          targetId.toString(),
          targetYear,
          targetMonth,
        );

        const rentPaise = assignment.monthlyRentPaise;

        try {
          await Invoice.create({
            organization: targetId,
            property: assignment.property,
            tenant: tenantId,
            invoiceNumber,
            month: targetMonth,
            year: targetYear,
            dueDate,
            items: [
              {
                description: `Monthly Rent - ${monthName}`,
                amountPaise: rentPaise,
                category: 'rent',
              },
            ],
            totalAmountPaise: rentPaise,
            amountPaidPaise: 0,
            balanceDuePaise: rentPaise,
            status: 'unpaid',
          });
          generatedCount++;
        } catch (err: unknown) {
          // Handle potential race condition on unique index { tenant: 1, month: 1, year: 1 }
          if ((err as { code?: number }).code === 11000) {
            skippedCount++;
          } else {
            throw err;
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Monthly invoice generation finished for ${monthName}`,
      data: {
        month: targetMonth,
        year: targetYear,
        generatedCount,
        skippedCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/invoices/:id/pay
 * Record partial or full payment for an invoice with receipt generation
 */
export const markInvoicePaid = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const userId = req.user?.id;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid invoice ID format', 400);
    }

    const parsed = markPaidSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.errors[0]?.message || 'Invalid monthly invoice parameters',
        400,
      );
    }

    const invoice = await Invoice.findOne({ _id: id, organization: orgId });
    if (!invoice) {
      throw new AppError('Invoice not found or does not belong to your organization', 404);
    }

    if (invoice.status === 'paid' || invoice.balanceDuePaise === 0) {
      throw new AppError('This invoice is already fully paid', 400);
    }

    const { amountPaise, paymentMethod, transactionReference, notes } = parsed.data;
    const paymentAmount = amountPaise !== undefined ? amountPaise : invoice.balanceDuePaise;

    if (paymentAmount <= 0) {
      throw new AppError('Payment amount must be greater than 0', 400);
    }

    if (paymentAmount > invoice.balanceDuePaise) {
      throw new AppError(
        `Payment amount cannot exceed balance due of ₹${(invoice.balanceDuePaise / 100).toFixed(2)}`,
        400,
      );
    }

    // Generate unique sequential receipt number
    const receiptNumber = await generateReceiptNumber(orgId!);

    // Create payment ledger record
    const payment = await Payment.create({
      organization: orgId,
      property: invoice.property,
      tenant: invoice.tenant,
      invoice: invoice._id,
      receiptNumber,
      amountPaidPaise: paymentAmount,
      paymentMethod,
      transactionReference,
      notes,
      recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
      paymentDate: new Date(),
    });

    // Update invoice balance and status
    invoice.amountPaidPaise += paymentAmount;
    invoice.balanceDuePaise = Math.max(0, invoice.totalAmountPaise - invoice.amountPaidPaise);
    invoice.status = invoice.balanceDuePaise === 0 ? 'paid' : 'partially_paid';
    if (invoice.balanceDuePaise === 0) {
      invoice.paidAt = new Date();
    }
    await invoice.save();

    res.status(200).json({
      success: true,
      message: `Payment of ₹${(paymentAmount / 100).toFixed(2)} recorded with receipt ${receiptNumber}`,
      data: {
        invoice,
        payment,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/payments
 * Query recorded payments / receipts scoped by organization
 */
export const getPayments = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    const filter: Record<string, unknown> = { organization: orgId };

    if (req.query.propertyId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.propertyId as string)) {
        throw new AppError('Invalid property ID format', 400);
      }
      filter.property = req.query.propertyId;
    }

    if (req.query.tenantId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.tenantId as string)) {
        throw new AppError('Invalid tenant ID format', 400);
      }
      filter.tenant = req.query.tenantId;
    }

    if (req.query.invoiceId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.invoiceId as string)) {
        throw new AppError('Invalid invoice ID format', 400);
      }
      filter.invoice = req.query.invoiceId;
    }

    const payments = await Payment.find(filter)
      .populate('tenant', 'fullName phone currentBed')
      .populate('property', 'name upiVpa')
      .populate('invoice', 'invoiceNumber month year')
      .sort({ paymentDate: -1 });

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error) {
    next(error);
  }
};
