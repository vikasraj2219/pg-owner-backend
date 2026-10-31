import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import {
  createPropertySchema,
  updatePropertySchema,
  createRoomSchema,
  updateRoomSchema,
} from '../validators/property.validator';
import { Property } from '../models/Property';
import { Room } from '../models/Room';
import { Bed } from '../models/Bed';
import { Subscription } from '../models/Subscription';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';

/**
 * Generate alphabet suffix for bed numbering:
 * 0 -> 'A', 1 -> 'B', 25 -> 'Z', 26 -> 'AA', 27 -> 'AB'
 */
export const getBedSuffix = (index: number): string => {
  let suffix = '';
  let num = index;
  while (num >= 0) {
    suffix = String.fromCharCode(65 + (num % 26)) + suffix;
    num = Math.floor(num / 26) - 1;
  }
  return suffix;
};

// ==========================================
// PROPERTY CONTROLLERS
// ==========================================

export const createProperty = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = createPropertySchema.parse(req.body);
    const orgId = req.orgId;

    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    // 1. Check for duplicate property name within the same organization
    const existingProperty = await Property.findOne({
      organization: orgId,
      name: { $regex: new RegExp(`^${input.name.trim()}$`, 'i') },
    });

    if (existingProperty) {
      throw new AppError(
        `A property named "${input.name}" already exists in your organization`,
        409,
      );
    }

    // 2. Check Subscription Quotas
    const sub = await Subscription.findOne({ organization: orgId });
    if (sub) {
      const propertyCount = await Property.countDocuments({ organization: orgId, isActive: true });
      if (propertyCount >= sub.maxProperties) {
        throw new AppError(
          `Subscription plan limit reached: Your ${sub.plan} plan allows up to ${sub.maxProperties} properties. Please upgrade your subscription to add more properties.`,
          403,
        );
      }
    }

    // 3. Create Property
    const property = await Property.create({
      ...input,
      organization: orgId,
    });

    res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

export const getProperties = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      throw new AppError('Organization context is required', 403);
    }

    const properties = await Property.find({ organization: orgId }).sort({ createdAt: -1 });

    // Aggregate stats for each property
    const propertiesWithStats = await Promise.all(
      properties.map(async property => {
        const totalRooms = await Room.countDocuments({ property: property._id });
        const [totalBeds, occupiedBeds, availableBeds] = await Promise.all([
          Bed.countDocuments({ property: property._id }),
          Bed.countDocuments({ property: property._id, status: 'occupied' }),
          Bed.countDocuments({ property: property._id, status: 'available' }),
        ]);

        return {
          ...property.toJSON(),
          stats: {
            totalRooms,
            totalBeds,
            occupiedBeds,
            availableBeds,
            occupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
          },
        };
      }),
    );

    res.status(200).json({
      success: true,
      count: propertiesWithStats.length,
      data: propertiesWithStats,
    });
  } catch (error) {
    next(error);
  }
};

export const getPropertyById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid property ID format', 400);
    }

    const property = await Property.findOne({ _id: id, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    const [totalRooms, totalBeds, occupiedBeds, availableBeds, noticePeriodBeds, maintenanceBeds] =
      await Promise.all([
        Room.countDocuments({ property: property._id }),
        Bed.countDocuments({ property: property._id }),
        Bed.countDocuments({ property: property._id, status: 'occupied' }),
        Bed.countDocuments({ property: property._id, status: 'available' }),
        Bed.countDocuments({ property: property._id, status: 'notice_period' }),
        Bed.countDocuments({ property: property._id, status: 'maintenance' }),
      ]);

    res.status(200).json({
      success: true,
      data: {
        ...property.toJSON(),
        stats: {
          totalRooms,
          totalBeds,
          occupiedBeds,
          availableBeds,
          noticePeriodBeds,
          maintenanceBeds,
          occupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateProperty = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid property ID format', 400);
    }

    const input = updatePropertySchema.parse(req.body);

    const property = await Property.findOne({ _id: id, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    // Check name uniqueness if updated
    if (input.name && input.name.trim().toLowerCase() !== property.name.toLowerCase()) {
      const duplicate = await Property.findOne({
        _id: { $ne: property._id },
        organization: orgId,
        name: { $regex: new RegExp(`^${input.name.trim()}$`, 'i') },
      });
      if (duplicate) {
        throw new AppError(
          `A property named "${input.name}" already exists in your organization`,
          409,
        );
      }
    }

    Object.assign(property, input);
    await property.save();

    res.status(200).json({
      success: true,
      message: 'Property updated successfully',
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteProperty = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid property ID format', 400);
    }

    const property = await Property.findOne({ _id: id, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    // Prevent deletion if occupied beds exist
    const occupiedBedsCount = await Bed.countDocuments({
      property: property._id,
      status: 'occupied',
    });

    if (occupiedBedsCount > 0) {
      throw new AppError(
        `Cannot delete property with ${occupiedBedsCount} currently occupied bed(s). Please vacate or relocate tenants first.`,
        400,
      );
    }

    // Delete associated rooms and beds inside transaction if possible
    let session: mongoose.ClientSession | null = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (_err) {
      session = null;
    }

    try {
      const sessionOpts = session ? { session } : {};
      await Bed.deleteMany({ property: property._id }, sessionOpts);
      await Room.deleteMany({ property: property._id }, sessionOpts);
      await Property.deleteOne({ _id: property._id }, sessionOpts);

      if (session) {
        await session.commitTransaction();
      }
    } catch (txError) {
      if (session) {
        await session.abortTransaction();
      }
      throw txError;
    } finally {
      if (session) {
        await session.endSession();
      }
    }

    res.status(200).json({
      success: true,
      message: 'Property and associated rooms/beds deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ROOM & BED GENERATION CONTROLLERS
// ==========================================

export const createRoom = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id: propertyId } = req.params;
    const orgId = req.orgId;

    if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
      throw new AppError('Invalid property ID format', 400);
    }

    const property = await Property.findOne({ _id: propertyId, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    const input = createRoomSchema.parse(req.body);

    // 1. Check duplicate roomNumber in this property
    const existingRoom = await Room.findOne({
      property: property._id,
      roomNumber: { $regex: new RegExp(`^${input.roomNumber.trim()}$`, 'i') },
    });

    if (existingRoom) {
      throw new AppError(
        `Room number "${input.roomNumber}" already exists in ${property.name}`,
        409,
      );
    }

    // 2. Check Subscription Bed Quotas
    const sub = await Subscription.findOne({ organization: orgId });
    if (sub) {
      const currentBedCount = await Bed.countDocuments({ organization: orgId });
      if (currentBedCount + input.sharingType > sub.maxBeds) {
        throw new AppError(
          `Subscription limit reached: Adding ${input.sharingType} bed(s) would exceed your ${sub.plan} plan quota of ${sub.maxBeds} beds. You currently have ${currentBedCount} beds. Please upgrade.`,
          403,
        );
      }
    }

    // 3. Atomically create Room and auto-generate Beds
    let session: mongoose.ClientSession | null = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (_sessionErr) {
      session = null;
    }

    try {
      const sessionOpts = session ? { session } : {};

      // Create Room
      const createdRooms = await Room.create(
        [
          {
            organization: orgId,
            property: property._id,
            floorNumber: input.floorNumber,
            roomNumber: input.roomNumber.trim(),
            sharingType: input.sharingType,
            baseRentPaisePerBed: input.baseRentPaisePerBed,
            tags: input.tags || [],
          },
        ],
        sessionOpts,
      );

      const room = createdRooms[0];
      if (!room) {
        throw new AppError('Failed to initialize room record', 500);
      }

      // Auto-generate Beds (e.g. 101-A, 101-B, etc.)
      const bedsPayload = Array.from({ length: input.sharingType }, (_, i) => ({
        organization: orgId,
        property: property._id,
        room: room._id,
        bedNumber: `${room.roomNumber}-${getBedSuffix(i)}`,
        status: 'available',
      }));

      const createdBeds = await Bed.create(bedsPayload, { ...sessionOpts, ordered: true });

      if (session) {
        await session.commitTransaction();
      }

      res.status(201).json({
        success: true,
        message: `Room ${room.roomNumber} created with ${createdBeds.length} auto-generated bed(s)`,
        data: {
          room,
          beds: createdBeds,
        },
      });
    } catch (txError) {
      if (session) {
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

export const getPropertyRooms = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id: propertyId } = req.params;
    const orgId = req.orgId;

    if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
      throw new AppError('Invalid property ID format', 400);
    }

    const property = await Property.findOne({ _id: propertyId, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    const filter: Record<string, unknown> = {
      property: property._id,
      organization: orgId,
    };

    if (req.query.floorNumber !== undefined) {
      const floor = parseInt(req.query.floorNumber as string, 10);
      if (!isNaN(floor)) {
        filter.floorNumber = floor;
      }
    }

    const rooms = await Room.find(filter).sort({ floorNumber: 1, roomNumber: 1 });

    const roomsWithBeds = await Promise.all(
      rooms.map(async room => {
        const beds = await Bed.find({ room: room._id }).sort({ bedNumber: 1 });
        return {
          ...room.toJSON(),
          beds,
        };
      }),
    );

    res.status(200).json({
      success: true,
      count: roomsWithBeds.length,
      data: roomsWithBeds,
    });
  } catch (error) {
    next(error);
  }
};

export const updateRoom = async (
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

    const input = updateRoomSchema.parse(req.body);

    const room = await Room.findOne({ _id: roomId, organization: orgId });
    if (!room) {
      throw new AppError('Room not found or does not belong to your organization', 404);
    }

    Object.assign(room, input);
    await room.save();

    res.status(200).json({
      success: true,
      message: 'Room updated successfully',
      data: room,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// VISUAL BED MATRIX CONTROLLER
// ==========================================

export const getPropertyMatrix = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id: propertyId } = req.params;
    const orgId = req.orgId;

    if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
      throw new AppError('Invalid property ID format', 400);
    }

    const property = await Property.findOne({ _id: propertyId, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    // Fetch all rooms sorted by floor and room number
    const rooms = await Room.find({ property: property._id, organization: orgId }).sort({
      floorNumber: 1,
      roomNumber: 1,
    });

    // Fetch all beds for this property
    const beds = await Bed.find({ property: property._id, organization: orgId })
      .populate('currentTenant', 'fullName phone monthlyRentPaise status')
      .sort({ bedNumber: 1 });

    // Map beds by room ID
    const bedsByRoom = new Map<string, typeof beds>();
    beds.forEach(bed => {
      const rId = bed.room.toString();
      const existing = bedsByRoom.get(rId) || [];
      existing.push(bed);
      bedsByRoom.set(rId, existing);
    });

    // Group rooms by floor
    const floorsMap = new Map<number, Array<Record<string, unknown>>>();

    rooms.forEach(room => {
      const roomBeds = bedsByRoom.get(room._id.toString()) || [];

      const formattedBeds = roomBeds.map(bed => ({
        _id: bed._id,
        bedNumber: bed.bedNumber,
        status: bed.status,
        currentTenant: bed.currentTenant,
        noticeEndDate: bed.noticeEndDate,
        maintenanceNote: bed.maintenanceNote,
        baseRentPaise: room.baseRentPaisePerBed,
      }));

      const roomData = {
        _id: room._id,
        roomNumber: room.roomNumber,
        floorNumber: room.floorNumber,
        sharingType: room.sharingType,
        baseRentPaisePerBed: room.baseRentPaisePerBed,
        tags: room.tags,
        beds: formattedBeds,
      };

      const floorRooms = floorsMap.get(room.floorNumber) || [];
      floorRooms.push(roomData);
      floorsMap.set(room.floorNumber, floorRooms);
    });

    // Sort floors in ascending order
    const floors = Array.from(floorsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([floorNumber, floorRooms]) => ({
        floorNumber,
        rooms: floorRooms,
      }));

    // Calculate overall stats
    const totalBeds = beds.length;
    const occupiedBeds = beds.filter(b => b.status === 'occupied').length;
    const availableBeds = beds.filter(b => b.status === 'available').length;
    const noticePeriodBeds = beds.filter(b => b.status === 'notice_period').length;
    const maintenanceBeds = beds.filter(b => b.status === 'maintenance').length;
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

    res.status(200).json({
      success: true,
      data: {
        property: {
          _id: property._id,
          name: property.name,
          type: property.type,
          address: property.address,
          upiVpa: property.upiVpa,
          electricityRatePaisePerUnit: property.electricityRatePaisePerUnit,
        },
        floors,
        summary: {
          totalRooms: rooms.length,
          totalBeds,
          occupiedBeds,
          availableBeds,
          noticePeriodBeds,
          maintenanceBeds,
          occupancyRate,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
