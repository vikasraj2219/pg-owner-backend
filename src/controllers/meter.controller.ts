import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { MeterReading, Room, Property, BedAssignment } from '../models';
import { createMeterReadingSchema, updateMeterReadingSchema } from '../validators/meter.validator';

/**
 * Record a sub-meter electricity reading and compute room tenant split
 * POST /api/meters/reading
 */
export const recordReading = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    const userId = req.user?.id;

    const validated = createMeterReadingSchema.parse(req.body);
    const {
      propertyId,
      roomId,
      meterIdentifier,
      previousReading,
      currentReading,
      ratePaisePerUnit,
      readingDate,
      photoUrl,
      splitMethod,
    } = validated;

    const property = await Property.findOne({ _id: propertyId, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    const room = await Room.findOne({ _id: roomId, property: propertyId, organization: orgId });
    if (!room) {
      throw new AppError('Room not found or does not belong to this property', 404);
    }

    const unitsConsumed = currentReading - previousReading;
    const effectiveRatePaise = ratePaisePerUnit ?? property.electricityRatePaisePerUnit ?? 0;
    const totalAmountPaise = Math.round(unitsConsumed * effectiveRatePaise);

    // Find all active tenants in this room
    const activeAssignments = await BedAssignment.find({
      room: roomId,
      organization: orgId,
      status: 'active',
    });

    const tenantSplits: Array<{
      tenant: mongoose.Types.ObjectId;
      daysOccupied: number;
      sharePaise: number;
    }> = [];

    if (activeAssignments.length > 0 && totalAmountPaise > 0) {
      if (splitMethod === 'by_days_occupied') {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const occupantDays = activeAssignments.map(as => {
          const checkin = new Date(as.startDate);
          const effectiveStart = checkin > startOfMonth ? checkin : startOfMonth;
          const days = Math.max(
            1,
            Math.ceil((now.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1,
          );
          return { tenant: as.tenant as mongoose.Types.ObjectId, days };
        });

        const totalDays = occupantDays.reduce((sum, od) => sum + od.days, 0);
        let allocatedPaise = 0;

        occupantDays.forEach((od, idx) => {
          const isLast = idx === occupantDays.length - 1;
          const share = isLast
            ? totalAmountPaise - allocatedPaise
            : Math.round((totalAmountPaise * od.days) / totalDays);
          allocatedPaise += share;

          tenantSplits.push({
            tenant: od.tenant,
            daysOccupied: od.days,
            sharePaise: share,
          });
        });
      } else {
        // Equal split
        const count = activeAssignments.length;
        const baseShare = Math.floor(totalAmountPaise / count);
        let remainder = totalAmountPaise % count;

        activeAssignments.forEach(as => {
          const share = baseShare + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder--;

          tenantSplits.push({
            tenant: as.tenant as mongoose.Types.ObjectId,
            daysOccupied: 30,
            sharePaise: share,
          });
        });
      }
    }

    const reading = await MeterReading.create({
      organization: orgId,
      property: propertyId,
      room: roomId,
      meterIdentifier: meterIdentifier || `Room ${room.roomNumber} Meter`,
      previousReading,
      currentReading,
      unitsConsumed,
      ratePaisePerUnit: effectiveRatePaise,
      totalAmountPaise,
      readingDate: readingDate ? new Date(readingDate) : new Date(),
      photoUrl,
      splitMethod,
      tenantSplits,
      recordedBy: userId ? new mongoose.Types.ObjectId(userId) : undefined,
    });

    res.status(201).json({
      success: true,
      message: `Meter reading recorded. ${unitsConsumed} units consumed (₹${(totalAmountPaise / 100).toFixed(2)}) split across ${tenantSplits.length} tenant(s).`,
      data: reading,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List meter readings
 * GET /api/meters/readings
 */
export const getReadings = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    const { propertyId, roomId } = req.query;

    const query: Record<string, unknown> = { organization: orgId };
    if (
      propertyId &&
      typeof propertyId === 'string' &&
      mongoose.Types.ObjectId.isValid(propertyId)
    ) {
      query.property = propertyId;
    }
    if (roomId && typeof roomId === 'string' && mongoose.Types.ObjectId.isValid(roomId)) {
      query.room = roomId;
    }

    const readings = await MeterReading.find(query)
      .populate('property', 'name code')
      .populate('room', 'roomNumber floorNumber')
      .populate('tenantSplits.tenant', 'fullName phone')
      .sort({ readingDate: -1 });

    res.status(200).json({
      success: true,
      data: readings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get latest meter reading for a specific room to pre-fill previous reading
 * GET /api/meters/room/:roomId/latest
 */
export const getLatestRoomReading = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { roomId } = req.params;
    const orgId = req.orgId;

    if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
      throw new AppError('Invalid room ID format', 400);
    }

    const latest = await MeterReading.findOne({ room: roomId, organization: orgId }).sort({
      readingDate: -1,
    });

    res.status(200).json({
      success: true,
      data: latest,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing meter reading and recalculate tenant splits
 * PUT /api/meters/reading/:id
 */
export const updateReading = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid meter reading ID format', 400);
    }

    const reading = await MeterReading.findOne({ _id: id, organization: orgId });
    if (!reading) {
      throw new AppError('Meter reading not found', 404);
    }

    const validated = updateMeterReadingSchema.parse(req.body);

    const prevReading =
      validated.previousReading !== undefined ? validated.previousReading : reading.previousReading;
    const currReading =
      validated.currentReading !== undefined ? validated.currentReading : reading.currentReading;

    if (currReading < prevReading) {
      throw new AppError(
        `Current reading (${currReading}) cannot be lower than previous reading (${prevReading})`,
        400,
      );
    }

    const property = await Property.findOne({ _id: reading.property, organization: orgId });
    const effectiveRatePaise =
      validated.ratePaisePerUnit ??
      reading.ratePaisePerUnit ??
      property?.electricityRatePaisePerUnit ??
      0;
    const splitMethod = validated.splitMethod ?? reading.splitMethod;
    const unitsConsumed = currReading - prevReading;
    const totalAmountPaise = Math.round(unitsConsumed * effectiveRatePaise);

    // Recalculate tenant splits
    const activeAssignments = await BedAssignment.find({
      room: reading.room,
      organization: orgId,
      status: 'active',
    });

    const tenantSplits: Array<{
      tenant: mongoose.Types.ObjectId;
      daysOccupied: number;
      sharePaise: number;
    }> = [];

    if (activeAssignments.length > 0 && totalAmountPaise > 0) {
      if (splitMethod === 'by_days_occupied') {
        const now = reading.readingDate || new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const occupantDays = activeAssignments.map(as => {
          const checkin = new Date(as.startDate);
          const effectiveStart = checkin > startOfMonth ? checkin : startOfMonth;
          const days = Math.max(
            1,
            Math.ceil((now.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1,
          );
          return { tenant: as.tenant as mongoose.Types.ObjectId, days };
        });

        const totalDays = occupantDays.reduce((sum, od) => sum + od.days, 0);
        let allocatedPaise = 0;

        occupantDays.forEach((od, idx) => {
          const isLast = idx === occupantDays.length - 1;
          const share = isLast
            ? totalAmountPaise - allocatedPaise
            : Math.round((totalAmountPaise * od.days) / totalDays);
          allocatedPaise += share;

          tenantSplits.push({
            tenant: od.tenant,
            daysOccupied: od.days,
            sharePaise: share,
          });
        });
      } else {
        const count = activeAssignments.length;
        const baseShare = Math.floor(totalAmountPaise / count);
        let remainder = totalAmountPaise % count;

        activeAssignments.forEach(as => {
          const share = baseShare + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder--;

          tenantSplits.push({
            tenant: as.tenant as mongoose.Types.ObjectId,
            daysOccupied: 30,
            sharePaise: share,
          });
        });
      }
    }

    if (validated.meterIdentifier !== undefined)
      reading.meterIdentifier = validated.meterIdentifier;
    reading.previousReading = prevReading;
    reading.currentReading = currReading;
    reading.unitsConsumed = unitsConsumed;
    reading.ratePaisePerUnit = effectiveRatePaise;
    reading.totalAmountPaise = totalAmountPaise;
    reading.splitMethod = splitMethod;
    reading.tenantSplits = tenantSplits as any;
    if (validated.readingDate) reading.readingDate = new Date(validated.readingDate);
    if (validated.photoUrl !== undefined) reading.photoUrl = validated.photoUrl;

    await reading.save();

    res.status(200).json({
      success: true,
      message: 'Meter reading updated successfully',
      data: reading,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a meter reading
 * DELETE /api/meters/reading/:id
 */
export const deleteReading = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid meter reading ID format', 400);
    }

    const reading = await MeterReading.findOneAndDelete({ _id: id, organization: orgId });
    if (!reading) {
      throw new AppError('Meter reading not found', 404);
    }

    res.status(200).json({
      success: true,
      message: 'Meter reading deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
