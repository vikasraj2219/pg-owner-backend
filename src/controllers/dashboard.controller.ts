import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Property } from '../models/Property';
import { Room } from '../models/Room';
import { Bed } from '../models/Bed';
import { Tenant } from '../models/Tenant';
import { Invoice } from '../models/Invoice';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';

export const getDashboardStats = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    const propertyFilter: Record<string, unknown> = { organization: orgId };
    if (req.query.propertyId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.propertyId as string)) {
        throw new AppError('Invalid property ID format', 400);
      }
      propertyFilter._id = req.query.propertyId;
    }

    const properties = await Property.find(propertyFilter);
    const propertyIds = properties.map(p => p._id);

    // Bed aggregations
    const bedQuery: Record<string, unknown> = { organization: orgId };
    if (propertyIds.length > 0) {
      bedQuery.property = { $in: propertyIds };
    }

    const [totalBeds, occupiedBeds, availableBeds, totalRooms, tenants] = await Promise.all([
      Bed.countDocuments(bedQuery),
      Bed.countDocuments({ ...bedQuery, status: 'occupied' }),
      Bed.countDocuments({ ...bedQuery, status: 'available' }),
      Room.countDocuments(bedQuery),
      Tenant.find({
        organization: orgId,
        status: 'active',
        ...(propertyIds.length > 0 ? { property: { $in: propertyIds } } : {}),
      }),
    ]);

    const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : 0;

    // Monthly financial stats (current month and year)
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const invoiceQuery: Record<string, unknown> = {
      organization: orgId,
      month: currentMonth,
      year: currentYear,
    };
    if (propertyIds.length > 0) {
      invoiceQuery.property = { $in: propertyIds };
    }

    const monthInvoices = await Invoice.find(invoiceQuery);

    let collectedThisMonthPaise = 0;
    let expectedThisMonthPaise = 0;

    for (const inv of monthInvoices) {
      collectedThisMonthPaise += inv.amountPaidPaise || 0;
      expectedThisMonthPaise += inv.totalAmountPaise || 0;
    }

    // If no invoices yet generated for current month, calculate expected from active tenants
    if (expectedThisMonthPaise === 0 && tenants.length > 0) {
      expectedThisMonthPaise = tenants.reduce((acc, t) => acc + (t.monthlyRentPaise || 0), 0);
    }

    const pendingAmountPaise = Math.max(0, expectedThisMonthPaise - collectedThisMonthPaise);
    const collectionRate =
      expectedThisMonthPaise > 0
        ? Math.round((collectedThisMonthPaise / expectedThisMonthPaise) * 100)
        : 0;

    // Overdue stats
    const overdueInvoices = await Invoice.find({
      organization: orgId,
      status: 'unpaid',
      dueDate: { $lt: now },
      ...(propertyIds.length > 0 ? { property: { $in: propertyIds } } : {}),
    });

    const overdueCount = overdueInvoices.length;
    const overdueAmountPaise = overdueInvoices.reduce(
      (acc, inv) => acc + (inv.balanceDuePaise || inv.totalAmountPaise || 0),
      0,
    );

    // Net operating profit (collections)
    const netProfitPaise = collectedThisMonthPaise;

    res.status(200).json({
      success: true,
      data: {
        totalRooms,
        totalBeds,
        occupiedBeds,
        availableBeds,
        occupancyRate,
        collectedThisMonthPaise,
        expectedThisMonthPaise,
        pendingAmountPaise,
        collectionRate,
        overdueCount,
        overdueAmountPaise,
        netProfitPaise,
        totalTenants: tenants.length,
      },
    });
  } catch (error) {
    next(error);
  }
};
