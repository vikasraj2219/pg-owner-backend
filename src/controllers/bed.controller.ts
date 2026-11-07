import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { updateBedStatusSchema, updateBedSchema } from '../validators/property.validator';
import { Bed } from '../models/Bed';
import { Room } from '../models/Room';
import { Tenant } from '../models/Tenant';
import { BedAssignment } from '../models/BedAssignment';
import { Invoice } from '../models/Invoice';
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

export const updateBed = async (
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

    const input = updateBedSchema.parse(req.body);

    const bed = await Bed.findOne({ _id: id, organization: orgId });
    if (!bed) {
      throw new AppError('Bed not found or does not belong to your organization', 404);
    }

    // Check duplicate bedNumber if updating
    if (input.bedNumber && input.bedNumber.trim() !== bed.bedNumber) {
      const duplicate = await Bed.findOne({
        _id: { $ne: bed._id },
        room: bed.room,
        bedNumber: { $regex: new RegExp(`^${input.bedNumber.trim()}$`, 'i') },
      });
      if (duplicate) {
        throw new AppError(`Bed label "${input.bedNumber}" already exists in this room`, 409);
      }
      bed.bedNumber = input.bedNumber.trim();
    }

    if (input.baseRentPaise !== undefined) {
      bed.baseRentPaise = input.baseRentPaise;
      // If the bed is occupied and rent changed, keep tenant, active assignment & unpaid invoice in sync
      if (bed.currentTenant) {
        await Tenant.updateOne(
          { _id: bed.currentTenant, organization: orgId },
          { monthlyRentPaise: input.baseRentPaise },
        );
        await BedAssignment.updateMany(
          { bed: bed._id, status: 'active', organization: orgId },
          { monthlyRentPaise: input.baseRentPaise },
        );
        // Also update any current unpaid invoice
        const unpaidInvoice = await Invoice.findOne({
          tenant: bed.currentTenant,
          organization: orgId,
          status: 'unpaid',
        }).sort({ createdAt: -1 });

        if (unpaidInvoice) {
          const rentItem = unpaidInvoice.items.find(it => it.category === 'rent');
          if (rentItem) {
            rentItem.amountPaise = input.baseRentPaise;
            unpaidInvoice.totalAmountPaise = unpaidInvoice.items.reduce(
              (acc, it) => acc + it.amountPaise,
              0,
            );
            unpaidInvoice.balanceDuePaise = Math.max(
              0,
              unpaidInvoice.totalAmountPaise - unpaidInvoice.amountPaidPaise,
            );
            await unpaidInvoice.save();
          }
        }
      }
    }

    if (input.status) {
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
    } else if (input.maintenanceNote !== undefined && bed.status === 'maintenance') {
      bed.maintenanceNote = input.maintenanceNote;
    }

    await bed.save();

    res.status(200).json({
      success: true,
      message: `Bed ${bed.bedNumber} updated successfully`,
      data: bed,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteBed = async (
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

    const bed = await Bed.findOne({ _id: id, organization: orgId });
    if (!bed) {
      throw new AppError('Bed not found or does not belong to your organization', 404);
    }

    if (bed.status === 'occupied' || bed.status === 'notice_period' || bed.currentTenant) {
      throw new AppError(
        `Cannot delete Bed ${bed.bedNumber} because it is currently occupied or on notice. Please check out or relocate the tenant first.`,
        400,
      );
    }

    const roomId = bed.room;
    await Bed.deleteOne({ _id: bed._id });

    if (roomId) {
      const remainingBeds = await Bed.countDocuments({ room: roomId });
      await Room.findByIdAndUpdate(roomId, { sharingType: Math.max(1, remainingBeds) });
    }

    res.status(200).json({
      success: true,
      message: `Bed ${bed.bedNumber} deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
};
