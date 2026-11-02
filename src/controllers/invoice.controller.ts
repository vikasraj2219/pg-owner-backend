import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';

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

    const filter: Record<string, unknown> = { organization: orgId };

    if (req.query.propertyId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.propertyId as string)) {
        throw new AppError('Invalid property ID format', 400);
      }
      filter.property = req.query.propertyId;
    }

    const statusParam = req.query.status as string | undefined;
    const now = new Date();

    if (statusParam === 'overdue') {
      filter.status = 'unpaid';
      filter.dueDate = { $lt: now };
    } else if (statusParam === 'unpaid') {
      filter.status = 'unpaid';
    } else if (statusParam === 'paid') {
      filter.status = 'paid';
    }

    const invoices = await Invoice.find(filter)
      .populate('tenant', 'fullName phone currentBed status')
      .populate('property', 'name type address upiVpa')
      .sort({ dueDate: -1, createdAt: -1 });

    // Format invoices with calculated overdue days
    const formattedInvoices = invoices.map(inv => {
      const invObj = inv.toObject();
      const dueDate = new Date(inv.dueDate);
      const diffTime = now.getTime() - dueDate.getTime();
      const overdueDays =
        inv.status === 'unpaid' && diffTime > 0
          ? Math.floor(diffTime / (1000 * 60 * 60 * 24))
          : 0;

      return {
        ...invObj,
        overdueDays,
      };
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

export const markInvoicePaid = async (
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

    const invoice = await Invoice.findOne({ _id: id, organization: orgId });
    if (!invoice) {
      throw new AppError('Invoice not found or does not belong to your organization', 404);
    }

    const amountPaid = req.body.amountPaise !== undefined ? Number(req.body.amountPaise) : invoice.totalAmountPaise;

    invoice.amountPaidPaise = amountPaid;
    invoice.balanceDuePaise = Math.max(0, invoice.totalAmountPaise - amountPaid);
    invoice.status = invoice.balanceDuePaise === 0 ? 'paid' : 'partially_paid';
    invoice.paidAt = new Date();
    await invoice.save();

    res.status(200).json({
      success: true,
      message: `Invoice #${invoice.invoiceNumber} marked as ${invoice.status}`,
      data: invoice,
    });
  } catch (error) {
    next(error);
  }
};
