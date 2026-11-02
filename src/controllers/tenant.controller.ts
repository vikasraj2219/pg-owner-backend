import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Tenant } from '../models/Tenant';
import { Invoice } from '../models/Invoice';
import { DepositLedger } from '../models/DepositLedger';
import { BedAssignment } from '../models/BedAssignment';
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
