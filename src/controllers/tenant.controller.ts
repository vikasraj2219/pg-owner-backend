import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Tenant } from '../models/Tenant';
import { Invoice } from '../models/Invoice';
import { DepositLedger } from '../models/DepositLedger';
import { BedAssignment } from '../models/BedAssignment';
import { Bed } from '../models/Bed';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';

export const getTenants = async (
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
        throw new AppError('Invalid propertyId format', 400);
      }
      filter.property = req.query.propertyId;
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.search) {
      const searchRegex = new RegExp(String(req.query.search).trim(), 'i');
      filter.$or = [{ fullName: searchRegex }, { phone: searchRegex }];
    }

    const tenants = await Tenant.find(filter)
      .populate('property', 'name type address')
      .populate({
        path: 'currentBed',
        select: 'bedNumber status room',
        populate: {
          path: 'room',
          select: 'roomNumber floorNumber sharingType',
        },
      })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: tenants.length,
      data: tenants,
    });
  } catch (error) {
    next(error);
  }
};

export const getTenantById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    const tenant = await Tenant.findOne({ _id: id, organization: orgId })
      .populate('property', 'name type address upiVpa electricityRatePaisePerUnit')
      .populate({
        path: 'currentBed',
        select: 'bedNumber status room noticeEndDate maintenanceNote',
        populate: {
          path: 'room',
          select: 'roomNumber floorNumber sharingType baseRentPaisePerBed tags',
        },
      });

    if (!tenant) {
      throw new AppError('Tenant not found or does not belong to your organization', 404);
    }

    // Fetch tenant's recent invoices and deposits
    const [invoices, deposits, bedHistory] = await Promise.all([
      Invoice.find({ tenant: tenant._id, organization: orgId }).sort({ year: -1, month: -1 }),
      DepositLedger.find({ tenant: tenant._id, organization: orgId }).sort({ date: -1 }),
      BedAssignment.find({ tenant: tenant._id, organization: orgId })
        .populate('bed', 'bedNumber')
        .populate('room', 'roomNumber floorNumber')
        .sort({ startDate: -1 }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        tenant,
        invoices,
        deposits,
        bedHistory,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const vacateTenant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    const userId = req.user?.id;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid tenant ID format', 400);
    }

    const tenant = await Tenant.findOne({ _id: id, organization: orgId });
    if (!tenant) {
      throw new AppError('Tenant not found or does not belong to your organization', 404);
    }

    const {
      deductionsPaise = 0,
      refundPaise = 0,
      paymentMethod = 'cash',
      notes = 'Checkout settlement',
    } = req.body;

    // 1. Release assigned bed if any
    if (tenant.currentBed) {
      const bed = await Bed.findOne({ _id: tenant.currentBed, organization: orgId });
      if (bed) {
        bed.status = 'available';
        bed.currentTenant = undefined;
        bed.noticeEndDate = undefined;
        bed.maintenanceNote = undefined;
        await bed.save();
      }
    }

    // 2. End bed assignment history
    await BedAssignment.updateMany(
      { tenant: tenant._id, organization: orgId, status: 'active' },
      { $set: { status: 'vacated', endDate: new Date(), notes } },
    );

    // 3. Record refund in DepositLedger if refundPaise > 0
    if (refundPaise > 0) {
      await DepositLedger.create({
        organization: orgId,
        property: tenant.property,
        tenant: tenant._id,
        amountPaise: refundPaise,
        type: 'refunded',
        paymentMethod,
        notes: `Checkout net deposit refund: ${notes}`,
        recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
        date: new Date(),
      });
    }

    // 4. Record deductions if deductionsPaise > 0
    if (deductionsPaise > 0) {
      await DepositLedger.create({
        organization: orgId,
        property: tenant.property,
        tenant: tenant._id,
        amountPaise: deductionsPaise,
        type: 'deducted',
        paymentMethod,
        notes: `Checkout damage/repair deduction: ${notes}`,
        recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
        date: new Date(),
      });
    }

    // 5. Update tenant status to checked_out
    tenant.status = 'checked_out';
    tenant.currentBed = undefined;
    await tenant.save();

    res.status(200).json({
      success: true,
      message: `Tenant ${tenant.fullName} successfully vacated and settled.`,
      data: {
        tenantId: tenant._id,
        status: tenant.status,
        netRefundPaise: refundPaise,
      },
    });
  } catch (error) {
    next(error);
  }
};
