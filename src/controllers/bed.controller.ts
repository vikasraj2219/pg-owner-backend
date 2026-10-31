import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { updateBedStatusSchema } from '../validators/property.validator';
import { Bed } from '../models/Bed';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';

export const getBedById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid bed ID format', 400);
    }

    const bed = await Bed.findOne({ _id: id, organization: orgId })
      .populate('room', 'roomNumber floorNumber sharingType baseRentPaisePerBed tags')
      .populate('property', 'name type upiVpa electricityRatePaisePerUnit')
      .populate('currentTenant', 'fullName phone monthlyRentPaise status');

    if (!bed) {
      throw new AppError('Bed not found or does not belong to your organization', 404);
    }

    res.status(200).json({
      success: true,
      data: bed,
    });
  } catch (error) {
    next(error);
  }
};

export const updateBedStatus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid bed ID format', 400);
    }

    const input = updateBedStatusSchema.parse(req.body);

    const bed = await Bed.findOne({ _id: id, organization: orgId });
    if (!bed) {
      throw new AppError('Bed not found or does not belong to your organization', 404);
    }

    // Guard: Do not manually set to available if currently occupied by active tenant
    if (bed.status === 'occupied' && input.status === 'available' && bed.currentTenant) {
      throw new AppError(
        'Cannot directly set an occupied bed to available while a tenant is assigned. Please use the checkout settlement process.',
        400,
      );
    }

    bed.status = input.status;

    if (input.status === 'maintenance') {
      bed.maintenanceNote = input.maintenanceNote || 'Under maintenance';
    } else if (input.status === 'available') {
      bed.maintenanceNote = undefined;
      bed.noticeEndDate = undefined;
    }

    if (input.status === 'notice_period' && input.noticeEndDate) {
      bed.noticeEndDate = new Date(input.noticeEndDate);
    }

    await bed.save();

    res.status(200).json({
      success: true,
      message: `Bed ${bed.bedNumber} status updated to ${bed.status}`,
      data: bed,
    });
  } catch (error) {
    next(error);
  }
};
