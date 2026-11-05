import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import {
  createPropertySchema,
  updatePropertySchema,
  createRoomSchema,
  updateRoomSchema,
  createFloorSchema,
  updateFloorSchema,
  addBedSchema,
} from '../validators/property.validator';
import { Property } from '../models/Property';
import { Room } from '../models/Room';
import { Bed } from '../models/Bed';
import '../models/Tenant';
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
        const distinctFloors = await Room.distinct('floorNumber', { property: property._id });
        const registeredFloors = (property.floors || []).map(f => f.floorNumber);
        const totalFloors = new Set([...distinctFloors, ...registeredFloors]).size;
        const totalRooms = await Room.countDocuments({ property: property._id });
        const [totalBeds, occupiedBeds, availableBeds] = await Promise.all([
          Bed.countDocuments({ property: property._id }),
          Bed.countDocuments({ property: property._id, status: 'occupied' }),
          Bed.countDocuments({ property: property._id, status: 'available' }),
        ]);

        return {
          ...property.toJSON(),
          stats: {
            totalFloors,
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
            floorLabel: input.floorLabel?.trim() || undefined,
            roomNumber: input.roomNumber.trim(),
            sharingType: input.sharingType,
            baseRentPaisePerBed: input.baseRentPaisePerBed,
            tags: input.tags || [],
          },
        ],
        sessionOpts,
      );

      // Ensure floor is tracked in property
      if (!property.floors) property.floors = [];
      const floorIdx = property.floors.findIndex(f => f.floorNumber === input.floorNumber);
      if (floorIdx >= 0) {
        const floorObj = property.floors[floorIdx];
        if (input.floorLabel && floorObj && !floorObj.floorLabel) {
          floorObj.floorLabel = input.floorLabel.trim();
          await property.save(sessionOpts);
        }
      } else {
        property.floors.push({
          floorNumber: input.floorNumber,
          floorLabel: input.floorLabel?.trim() || undefined,
        });
        await property.save(sessionOpts);
      }

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

    // 1. Update room number if provided and different
    if (
      input.roomNumber &&
      input.roomNumber.trim().toLowerCase() !== room.roomNumber.toLowerCase()
    ) {
      const duplicate = await Room.findOne({
        _id: { $ne: room._id },
        property: room.property,
        organization: orgId,
        roomNumber: { $regex: new RegExp(`^${input.roomNumber.trim()}$`, 'i') },
      });
      if (duplicate) {
        throw new AppError(`Room "${input.roomNumber}" already exists in this property`, 409);
      }

      const oldPrefix = room.roomNumber;
      const newPrefix = input.roomNumber.trim();

      // Update associated bed labels prefix
      const existingBeds = await Bed.find({ room: room._id });
      for (const bed of existingBeds) {
        if (bed.bedNumber.startsWith(oldPrefix)) {
          bed.bedNumber = bed.bedNumber.replace(oldPrefix, newPrefix);
          await bed.save();
        }
      }

      room.roomNumber = newPrefix;
    }

    // 2. Update floor number if provided
    if (input.floorNumber !== undefined) {
      room.floorNumber = input.floorNumber;
    }

    if (input.floorLabel !== undefined) {
      room.floorLabel = input.floorLabel.trim() || undefined;
    }

    // 3. Update rent if provided
    if (input.baseRentPaisePerBed !== undefined) {
      room.baseRentPaisePerBed = input.baseRentPaisePerBed;
    }

    // 4. Update tags if provided
    if (input.tags !== undefined) {
      room.tags = input.tags;
    }

    // 5. Update sharing capacity if provided
    if (input.sharingType !== undefined && input.sharingType !== room.sharingType) {
      if (input.sharingType > room.sharingType) {
        const additionalBeds = input.sharingType - room.sharingType;

        // Check subscription quota
        const sub = await Subscription.findOne({ organization: orgId });
        if (sub) {
          const currentBedCount = await Bed.countDocuments({ organization: orgId });
          if (currentBedCount + additionalBeds > sub.maxBeds) {
            throw new AppError(
              `Subscription limit reached: Adding ${additionalBeds} bed(s) would exceed your ${sub.plan.toUpperCase()} plan quota of ${sub.maxBeds} beds. You currently have ${currentBedCount} beds. Please upgrade.`,
              403,
              'PLAN_LIMIT_REACHED',
            );
          }
        }

        // Generate additional beds
        const existingBeds = await Bed.find({ room: room._id });
        const existingNumbers = new Set(existingBeds.map(b => b.bedNumber.trim()));
        const newBeds = [];
        let suffixIdx = existingBeds.length;

        while (newBeds.length < additionalBeds) {
          const suffix = getBedSuffix(suffixIdx);
          const candidateNumber = `${room.roomNumber}-${suffix}`;
          if (!existingNumbers.has(candidateNumber)) {
            newBeds.push({
              organization: orgId,
              property: room.property,
              room: room._id,
              bedNumber: candidateNumber,
              status: 'available',
            });
            existingNumbers.add(candidateNumber);
          }
          suffixIdx++;
        }

        await Bed.insertMany(newBeds);
        room.sharingType = input.sharingType;
      } else if (input.sharingType < room.sharingType) {
        const bedsToRemoveCount = room.sharingType - input.sharingType;

        // Find vacant beds that can be safely removed
        const roomBeds = await Bed.find({ room: room._id }).sort({ createdAt: -1 });
        const vacantBeds = roomBeds.filter(
          b => b.status === 'available' || b.status === 'maintenance',
        );

        if (vacantBeds.length < bedsToRemoveCount) {
          throw new AppError(
            `Cannot reduce sharing capacity to ${input.sharingType} bed(s). Only vacant beds can be removed, and there are not enough vacant beds in Room ${room.roomNumber}.`,
            400,
          );
        }

        const bedIdsToDelete = vacantBeds.slice(0, bedsToRemoveCount).map(b => b._id);
        await Bed.deleteMany({ _id: { $in: bedIdsToDelete } });
        room.sharingType = input.sharingType;
      }
    }

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

export const deleteRoom = async (
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

    const room = await Room.findOne({ _id: roomId, organization: orgId });
    if (!room) {
      throw new AppError('Room not found or does not belong to your organization', 404);
    }

    // Safety Check: Check if any bed in this room is occupied or in notice period
    const occupiedOrNoticeBeds = await Bed.countDocuments({
      room: room._id,
      $or: [
        { status: 'occupied' },
        { status: 'notice_period' },
        { currentTenant: { $exists: true, $ne: null } },
      ],
    });

    if (occupiedOrNoticeBeds > 0) {
      throw new AppError(
        `Cannot delete Room ${room.roomNumber} because it contains ${occupiedOrNoticeBeds} occupied or notice-period bed(s). Please vacate or relocate tenants first.`,
        400,
      );
    }

    // Safe to delete beds and room
    await Bed.deleteMany({ room: room._id });
    await Room.deleteOne({ _id: room._id });

    res.status(200).json({
      success: true,
      message: `Room ${room.roomNumber} and its beds have been deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
};

export const addBedToRoom = async (
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

    const room = await Room.findOne({ _id: roomId, organization: orgId });
    if (!room) {
      throw new AppError('Room not found or does not belong to your organization', 404);
    }

    // Check subscription quota
    const sub = await Subscription.findOne({ organization: orgId });
    if (sub) {
      const currentBedCount = await Bed.countDocuments({ organization: orgId });
      if (currentBedCount >= sub.maxBeds) {
        throw new AppError(
          `Subscription limit reached: You have reached your ${sub.plan.toUpperCase()} plan quota of ${sub.maxBeds} beds. Please upgrade your subscription to add more beds.`,
          403,
          'PLAN_LIMIT_REACHED',
        );
      }
    }

    const input = addBedSchema.parse(req.body);

    // Determine next bed number if not provided
    let bedNumber = input.bedNumber?.trim();
    if (!bedNumber) {
      const existingBeds = await Bed.find({ room: room._id });
      const existingBedNumbers = new Set(existingBeds.map(b => b.bedNumber.trim()));
      let idx = existingBeds.length;
      while (!bedNumber || existingBedNumbers.has(bedNumber)) {
        bedNumber = `${room.roomNumber}-${getBedSuffix(idx)}`;
        idx++;
      }
    } else {
      const duplicate = await Bed.findOne({
        room: room._id,
        bedNumber: { $regex: new RegExp(`^${bedNumber}$`, 'i') },
      });
      if (duplicate) {
        throw new AppError(`Bed "${bedNumber}" already exists in Room ${room.roomNumber}`, 409);
      }
    }

    const newBed = await Bed.create({
      organization: orgId,
      property: room.property,
      room: room._id,
      bedNumber,
      status: 'available',
    });

    // Update room sharing type count
    const totalBedsInRoom = await Bed.countDocuments({ room: room._id });
    room.sharingType = totalBedsInRoom;
    await room.save();

    res.status(201).json({
      success: true,
      message: `Bed ${bedNumber} added successfully to Room ${room.roomNumber}`,
      data: newBed,
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
      .populate(
        'currentTenant',
        'fullName phone monthlyRentPaise status kycDocUrl kycDocType kycMaskedNumber',
      )
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
    interface FloorAggregation {
      floorNumber: number;
      floorLabel?: string;
      rooms: Array<Record<string, unknown>>;
      totalRooms: number;
      totalBeds: number;
      occupiedBeds: number;
    }

    const floorsMap = new Map<number, FloorAggregation>();

    // Prepopulate registered floors if any
    if (property.floors && Array.isArray(property.floors)) {
      property.floors.forEach(f => {
        floorsMap.set(f.floorNumber, {
          floorNumber: f.floorNumber,
          floorLabel: f.floorLabel || undefined,
          rooms: [],
          totalRooms: 0,
          totalBeds: 0,
          occupiedBeds: 0,
        });
      });
    }

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
        floorLabel: room.floorLabel,
        sharingType: room.sharingType,
        baseRentPaisePerBed: room.baseRentPaisePerBed,
        tags: room.tags,
        beds: formattedBeds,
      };

      const floorEntry = floorsMap.get(room.floorNumber) || {
        floorNumber: room.floorNumber,
        floorLabel: room.floorLabel || undefined,
        rooms: [],
        totalRooms: 0,
        totalBeds: 0,
        occupiedBeds: 0,
      };

      if (room.floorLabel && !floorEntry.floorLabel) {
        floorEntry.floorLabel = room.floorLabel;
      }

      floorEntry.rooms.push(roomData);
      floorEntry.totalRooms += 1;
      floorEntry.totalBeds += roomBeds.length;
      floorEntry.occupiedBeds += roomBeds.filter(b => b.status === 'occupied').length;

      floorsMap.set(room.floorNumber, floorEntry);
    });

    // Sort floors in ascending order
    const floors = Array.from(floorsMap.values()).sort((a, b) => a.floorNumber - b.floorNumber);

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
          city: property.city,
          pincode: property.pincode,
          upiVpa: property.upiVpa,
          electricityRatePaisePerUnit: property.electricityRatePaisePerUnit,
          isArchived: property.isArchived,
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

// ==========================================
// FLOOR CONTROLLERS
// ==========================================

export const createFloor = async (
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

    const input = createFloorSchema.parse(req.body);

    const existingFloor = (property.floors || []).find(f => f.floorNumber === input.floorNumber);
    const existingRoom = await Room.findOne({
      property: property._id,
      floorNumber: input.floorNumber,
    });

    if (existingFloor || existingRoom) {
      throw new AppError(`Floor ${input.floorNumber} already exists in ${property.name}`, 409);
    }

    if (!property.floors) {
      property.floors = [];
    }

    property.floors.push({
      floorNumber: input.floorNumber,
      floorLabel: input.floorLabel?.trim() || undefined,
    });

    await property.save();

    res.status(201).json({
      success: true,
      message: `Floor ${input.floorNumber} added successfully`,
      data: {
        floorNumber: input.floorNumber,
        floorLabel: input.floorLabel?.trim(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateFloor = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id: propertyId, floorNumber: floorNumberParam } = req.params;
    const orgId = req.orgId;
    if (!floorNumberParam) {
      throw new AppError('Invalid floor number', 400);
    }
    const currentFloorNumber = parseInt(floorNumberParam, 10);

    if (isNaN(currentFloorNumber)) {
      throw new AppError('Invalid floor number', 400);
    }

    const property = await Property.findOne({ _id: propertyId, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    const input = updateFloorSchema.parse(req.body);

    // If floorNumber changed
    if (input.floorNumber !== undefined && input.floorNumber !== currentFloorNumber) {
      const targetInFloors = (property.floors || []).some(f => f.floorNumber === input.floorNumber);
      const targetInRooms = await Room.findOne({
        property: property._id,
        floorNumber: input.floorNumber,
      });
      if (targetInFloors || targetInRooms) {
        throw new AppError(`Floor ${input.floorNumber} already exists in this property`, 409);
      }

      // Check if tenants are staying on current floor
      const roomsOnFloor = await Room.find({
        property: property._id,
        floorNumber: currentFloorNumber,
      });
      const roomIds = roomsOnFloor.map(r => r._id);
      const occupiedBedsCount = await Bed.countDocuments({
        room: { $in: roomIds },
        status: { $in: ['occupied', 'notice_period'] },
      });

      if (occupiedBedsCount > 0) {
        throw new AppError(
          `Cannot change Floor number while ${occupiedBedsCount} tenant(s) are staying on this floor. Move or check them out first.`,
          400,
        );
      }

      // Update rooms
      await Room.updateMany(
        { property: property._id, floorNumber: currentFloorNumber },
        { floorNumber: input.floorNumber },
      );
    }

    const effectiveFloorNumber =
      input.floorNumber !== undefined ? input.floorNumber : currentFloorNumber;

    if (input.floorLabel !== undefined) {
      await Room.updateMany(
        { property: property._id, floorNumber: effectiveFloorNumber },
        { floorLabel: input.floorLabel.trim() },
      );
    }

    // Update in property.floors
    if (!property.floors) property.floors = [];
    const floorIndex = property.floors.findIndex(f => f.floorNumber === currentFloorNumber);
    if (floorIndex >= 0 && property.floors[floorIndex]) {
      property.floors[floorIndex].floorNumber = effectiveFloorNumber;
      if (input.floorLabel !== undefined) {
        property.floors[floorIndex].floorLabel = input.floorLabel.trim();
      }
    } else {
      property.floors.push({
        floorNumber: effectiveFloorNumber,
        floorLabel: input.floorLabel?.trim(),
      });
    }

    await property.save();

    res.status(200).json({
      success: true,
      message: 'Floor updated successfully',
      data: {
        floorNumber: effectiveFloorNumber,
        floorLabel: input.floorLabel !== undefined ? input.floorLabel.trim() : undefined,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteFloor = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id: propertyId, floorNumber: floorNumberParam } = req.params;
    const orgId = req.orgId;
    if (!floorNumberParam) {
      throw new AppError('Invalid floor number', 400);
    }
    const floorNumber = parseInt(floorNumberParam, 10);

    if (isNaN(floorNumber)) {
      throw new AppError('Invalid floor number', 400);
    }

    const property = await Property.findOne({ _id: propertyId, organization: orgId });
    if (!property) {
      throw new AppError('Property not found or does not belong to your organization', 404);
    }

    const roomsOnFloor = await Room.find({ property: property._id, floorNumber });
    const roomIds = roomsOnFloor.map(r => r._id);

    const occupiedBedsCount = await Bed.countDocuments({
      room: { $in: roomIds },
      status: { $in: ['occupied', 'notice_period'] },
    });

    if (occupiedBedsCount > 0) {
      throw new AppError(
        `Can't delete Floor ${floorNumber}. ${occupiedBedsCount} tenant(s) are staying on this floor. Move or check them out first, then you can delete the floor and its rooms.`,
        400,
      );
    }

    // Safe to delete beds and rooms on this floor
    await Bed.deleteMany({ room: { $in: roomIds } });
    await Room.deleteMany({ property: property._id, floorNumber });

    if (property.floors) {
      property.floors = property.floors.filter(f => f.floorNumber !== floorNumber);
      await property.save();
    }

    res.status(200).json({
      success: true,
      message: `Floor ${floorNumber} and its vacant rooms were deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
};
