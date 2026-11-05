"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPropertyMatrix = exports.addBedToRoom = exports.deleteRoom = exports.updateRoom = exports.getPropertyRooms = exports.createRoom = exports.deleteProperty = exports.updateProperty = exports.getPropertyById = exports.getProperties = exports.createProperty = exports.getBedSuffix = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const property_validator_1 = require("../validators/property.validator");
const Property_1 = require("../models/Property");
const Room_1 = require("../models/Room");
const Bed_1 = require("../models/Bed");
require("../models/Tenant");
const Subscription_1 = require("../models/Subscription");
const errorHandler_1 = require("../middleware/errorHandler");
/**
 * Generate alphabet suffix for bed numbering:
 * 0 -> 'A', 1 -> 'B', 25 -> 'Z', 26 -> 'AA', 27 -> 'AB'
 */
const getBedSuffix = (index) => {
    let suffix = '';
    let num = index;
    while (num >= 0) {
        suffix = String.fromCharCode(65 + (num % 26)) + suffix;
        num = Math.floor(num / 26) - 1;
    }
    return suffix;
};
exports.getBedSuffix = getBedSuffix;
// ==========================================
// PROPERTY CONTROLLERS
// ==========================================
const createProperty = async (req, res, next) => {
    try {
        const input = property_validator_1.createPropertySchema.parse(req.body);
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        // 1. Check for duplicate property name within the same organization
        const existingProperty = await Property_1.Property.findOne({
            organization: orgId,
            name: { $regex: new RegExp(`^${input.name.trim()}$`, 'i') },
        });
        if (existingProperty) {
            throw new errorHandler_1.AppError(`A property named "${input.name}" already exists in your organization`, 409);
        }
        // 2. Check Subscription Quotas
        const sub = await Subscription_1.Subscription.findOne({ organization: orgId });
        if (sub) {
            const propertyCount = await Property_1.Property.countDocuments({ organization: orgId, isActive: true });
            if (propertyCount >= sub.maxProperties) {
                throw new errorHandler_1.AppError(`Subscription plan limit reached: Your ${sub.plan} plan allows up to ${sub.maxProperties} properties. Please upgrade your subscription to add more properties.`, 403);
            }
        }
        // 3. Create Property
        const property = await Property_1.Property.create({
            ...input,
            organization: orgId,
        });
        res.status(201).json({
            success: true,
            message: 'Property created successfully',
            data: property,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.createProperty = createProperty;
const getProperties = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        const properties = await Property_1.Property.find({ organization: orgId }).sort({ createdAt: -1 });
        // Aggregate stats for each property
        const propertiesWithStats = await Promise.all(properties.map(async (property) => {
            const totalRooms = await Room_1.Room.countDocuments({ property: property._id });
            const [totalBeds, occupiedBeds, availableBeds] = await Promise.all([
                Bed_1.Bed.countDocuments({ property: property._id }),
                Bed_1.Bed.countDocuments({ property: property._id, status: 'occupied' }),
                Bed_1.Bed.countDocuments({ property: property._id, status: 'available' }),
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
        }));
        res.status(200).json({
            success: true,
            count: propertiesWithStats.length,
            data: propertiesWithStats,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getProperties = getProperties;
const getPropertyById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid property ID format', 400);
        }
        const property = await Property_1.Property.findOne({ _id: id, organization: orgId });
        if (!property) {
            throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
        }
        const [totalRooms, totalBeds, occupiedBeds, availableBeds, noticePeriodBeds, maintenanceBeds] = await Promise.all([
            Room_1.Room.countDocuments({ property: property._id }),
            Bed_1.Bed.countDocuments({ property: property._id }),
            Bed_1.Bed.countDocuments({ property: property._id, status: 'occupied' }),
            Bed_1.Bed.countDocuments({ property: property._id, status: 'available' }),
            Bed_1.Bed.countDocuments({ property: property._id, status: 'notice_period' }),
            Bed_1.Bed.countDocuments({ property: property._id, status: 'maintenance' }),
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
    }
    catch (error) {
        next(error);
    }
};
exports.getPropertyById = getPropertyById;
const updateProperty = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid property ID format', 400);
        }
        const input = property_validator_1.updatePropertySchema.parse(req.body);
        const property = await Property_1.Property.findOne({ _id: id, organization: orgId });
        if (!property) {
            throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
        }
        // Check name uniqueness if updated
        if (input.name && input.name.trim().toLowerCase() !== property.name.toLowerCase()) {
            const duplicate = await Property_1.Property.findOne({
                _id: { $ne: property._id },
                organization: orgId,
                name: { $regex: new RegExp(`^${input.name.trim()}$`, 'i') },
            });
            if (duplicate) {
                throw new errorHandler_1.AppError(`A property named "${input.name}" already exists in your organization`, 409);
            }
        }
        Object.assign(property, input);
        await property.save();
        res.status(200).json({
            success: true,
            message: 'Property updated successfully',
            data: property,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateProperty = updateProperty;
const deleteProperty = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid property ID format', 400);
        }
        const property = await Property_1.Property.findOne({ _id: id, organization: orgId });
        if (!property) {
            throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
        }
        // Prevent deletion if occupied beds exist
        const occupiedBedsCount = await Bed_1.Bed.countDocuments({
            property: property._id,
            status: 'occupied',
        });
        if (occupiedBedsCount > 0) {
            throw new errorHandler_1.AppError(`Cannot delete property with ${occupiedBedsCount} currently occupied bed(s). Please vacate or relocate tenants first.`, 400);
        }
        // Delete associated rooms and beds inside transaction if possible
        let session = null;
        try {
            session = await mongoose_1.default.startSession();
            session.startTransaction();
        }
        catch (_err) {
            session = null;
        }
        try {
            const sessionOpts = session ? { session } : {};
            await Bed_1.Bed.deleteMany({ property: property._id }, sessionOpts);
            await Room_1.Room.deleteMany({ property: property._id }, sessionOpts);
            await Property_1.Property.deleteOne({ _id: property._id }, sessionOpts);
            if (session) {
                await session.commitTransaction();
            }
        }
        catch (txError) {
            if (session) {
                await session.abortTransaction();
            }
            throw txError;
        }
        finally {
            if (session) {
                await session.endSession();
            }
        }
        res.status(200).json({
            success: true,
            message: 'Property and associated rooms/beds deleted successfully',
        });
    }
    catch (error) {
        next(error);
    }
};
exports.deleteProperty = deleteProperty;
// ==========================================
// ROOM & BED GENERATION CONTROLLERS
// ==========================================
const createRoom = async (req, res, next) => {
    try {
        const { id: propertyId } = req.params;
        const orgId = req.orgId;
        if (!propertyId || !mongoose_1.default.Types.ObjectId.isValid(propertyId)) {
            throw new errorHandler_1.AppError('Invalid property ID format', 400);
        }
        const property = await Property_1.Property.findOne({ _id: propertyId, organization: orgId });
        if (!property) {
            throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
        }
        const input = property_validator_1.createRoomSchema.parse(req.body);
        // 1. Check duplicate roomNumber in this property
        const existingRoom = await Room_1.Room.findOne({
            property: property._id,
            roomNumber: { $regex: new RegExp(`^${input.roomNumber.trim()}$`, 'i') },
        });
        if (existingRoom) {
            throw new errorHandler_1.AppError(`Room number "${input.roomNumber}" already exists in ${property.name}`, 409);
        }
        // 2. Check Subscription Bed Quotas
        const sub = await Subscription_1.Subscription.findOne({ organization: orgId });
        if (sub) {
            const currentBedCount = await Bed_1.Bed.countDocuments({ organization: orgId });
            if (currentBedCount + input.sharingType > sub.maxBeds) {
                throw new errorHandler_1.AppError(`Subscription limit reached: Adding ${input.sharingType} bed(s) would exceed your ${sub.plan} plan quota of ${sub.maxBeds} beds. You currently have ${currentBedCount} beds. Please upgrade.`, 403);
            }
        }
        // 3. Atomically create Room and auto-generate Beds
        let session = null;
        try {
            session = await mongoose_1.default.startSession();
            session.startTransaction();
        }
        catch (_sessionErr) {
            session = null;
        }
        try {
            const sessionOpts = session ? { session } : {};
            // Create Room
            const createdRooms = await Room_1.Room.create([
                {
                    organization: orgId,
                    property: property._id,
                    floorNumber: input.floorNumber,
                    roomNumber: input.roomNumber.trim(),
                    sharingType: input.sharingType,
                    baseRentPaisePerBed: input.baseRentPaisePerBed,
                    tags: input.tags || [],
                },
            ], sessionOpts);
            const room = createdRooms[0];
            if (!room) {
                throw new errorHandler_1.AppError('Failed to initialize room record', 500);
            }
            // Auto-generate Beds (e.g. 101-A, 101-B, etc.)
            const bedsPayload = Array.from({ length: input.sharingType }, (_, i) => ({
                organization: orgId,
                property: property._id,
                room: room._id,
                bedNumber: `${room.roomNumber}-${(0, exports.getBedSuffix)(i)}`,
                status: 'available',
            }));
            const createdBeds = await Bed_1.Bed.create(bedsPayload, { ...sessionOpts, ordered: true });
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
        }
        catch (txError) {
            if (session) {
                await session.abortTransaction();
            }
            throw txError;
        }
        finally {
            if (session) {
                await session.endSession();
            }
        }
    }
    catch (error) {
        next(error);
    }
};
exports.createRoom = createRoom;
const getPropertyRooms = async (req, res, next) => {
    try {
        const { id: propertyId } = req.params;
        const orgId = req.orgId;
        if (!propertyId || !mongoose_1.default.Types.ObjectId.isValid(propertyId)) {
            throw new errorHandler_1.AppError('Invalid property ID format', 400);
        }
        const property = await Property_1.Property.findOne({ _id: propertyId, organization: orgId });
        if (!property) {
            throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
        }
        const filter = {
            property: property._id,
            organization: orgId,
        };
        if (req.query.floorNumber !== undefined) {
            const floor = parseInt(req.query.floorNumber, 10);
            if (!isNaN(floor)) {
                filter.floorNumber = floor;
            }
        }
        const rooms = await Room_1.Room.find(filter).sort({ floorNumber: 1, roomNumber: 1 });
        const roomsWithBeds = await Promise.all(rooms.map(async (room) => {
            const beds = await Bed_1.Bed.find({ room: room._id }).sort({ bedNumber: 1 });
            return {
                ...room.toJSON(),
                beds,
            };
        }));
        res.status(200).json({
            success: true,
            count: roomsWithBeds.length,
            data: roomsWithBeds,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getPropertyRooms = getPropertyRooms;
const updateRoom = async (req, res, next) => {
    try {
        const { roomId } = req.params;
        const orgId = req.orgId;
        if (!roomId || !mongoose_1.default.Types.ObjectId.isValid(roomId)) {
            throw new errorHandler_1.AppError('Invalid room ID format', 400);
        }
        const input = property_validator_1.updateRoomSchema.parse(req.body);
        const room = await Room_1.Room.findOne({ _id: roomId, organization: orgId });
        if (!room) {
            throw new errorHandler_1.AppError('Room not found or does not belong to your organization', 404);
        }
        // 1. Update room number if provided and different
        if (input.roomNumber && input.roomNumber.trim().toLowerCase() !== room.roomNumber.toLowerCase()) {
            const duplicate = await Room_1.Room.findOne({
                _id: { $ne: room._id },
                property: room.property,
                organization: orgId,
                roomNumber: { $regex: new RegExp(`^${input.roomNumber.trim()}$`, 'i') },
            });
            if (duplicate) {
                throw new errorHandler_1.AppError(`Room "${input.roomNumber}" already exists in this property`, 409);
            }
            const oldPrefix = room.roomNumber;
            const newPrefix = input.roomNumber.trim();
            // Update associated bed labels prefix
            const existingBeds = await Bed_1.Bed.find({ room: room._id });
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
                const sub = await Subscription_1.Subscription.findOne({ organization: orgId });
                if (sub) {
                    const currentBedCount = await Bed_1.Bed.countDocuments({ organization: orgId });
                    if (currentBedCount + additionalBeds > sub.maxBeds) {
                        throw new errorHandler_1.AppError(`Subscription limit reached: Adding ${additionalBeds} bed(s) would exceed your ${sub.plan.toUpperCase()} plan quota of ${sub.maxBeds} beds. You currently have ${currentBedCount} beds. Please upgrade.`, 403, 'PLAN_LIMIT_REACHED');
                    }
                }
                // Generate additional beds
                const existingBeds = await Bed_1.Bed.find({ room: room._id });
                const existingNumbers = new Set(existingBeds.map(b => b.bedNumber.trim()));
                const newBeds = [];
                let suffixIdx = existingBeds.length;
                while (newBeds.length < additionalBeds) {
                    const suffix = (0, exports.getBedSuffix)(suffixIdx);
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
                await Bed_1.Bed.insertMany(newBeds);
                room.sharingType = input.sharingType;
            }
            else if (input.sharingType < room.sharingType) {
                const bedsToRemoveCount = room.sharingType - input.sharingType;
                // Find vacant beds that can be safely removed
                const roomBeds = await Bed_1.Bed.find({ room: room._id }).sort({ createdAt: -1 });
                const vacantBeds = roomBeds.filter(b => b.status === 'available' || b.status === 'maintenance');
                if (vacantBeds.length < bedsToRemoveCount) {
                    throw new errorHandler_1.AppError(`Cannot reduce sharing capacity to ${input.sharingType} bed(s). Only vacant beds can be removed, and there are not enough vacant beds in Room ${room.roomNumber}.`, 400);
                }
                const bedIdsToDelete = vacantBeds.slice(0, bedsToRemoveCount).map(b => b._id);
                await Bed_1.Bed.deleteMany({ _id: { $in: bedIdsToDelete } });
                room.sharingType = input.sharingType;
            }
        }
        await room.save();
        res.status(200).json({
            success: true,
            message: 'Room updated successfully',
            data: room,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateRoom = updateRoom;
const deleteRoom = async (req, res, next) => {
    try {
        const { roomId } = req.params;
        const orgId = req.orgId;
        if (!roomId || !mongoose_1.default.Types.ObjectId.isValid(roomId)) {
            throw new errorHandler_1.AppError('Invalid room ID format', 400);
        }
        const room = await Room_1.Room.findOne({ _id: roomId, organization: orgId });
        if (!room) {
            throw new errorHandler_1.AppError('Room not found or does not belong to your organization', 404);
        }
        // Safety Check: Check if any bed in this room is occupied or in notice period
        const occupiedOrNoticeBeds = await Bed_1.Bed.countDocuments({
            room: room._id,
            $or: [
                { status: 'occupied' },
                { status: 'notice_period' },
                { currentTenant: { $exists: true, $ne: null } },
            ],
        });
        if (occupiedOrNoticeBeds > 0) {
            throw new errorHandler_1.AppError(`Cannot delete Room ${room.roomNumber} because it contains ${occupiedOrNoticeBeds} occupied or notice-period bed(s). Please vacate or relocate tenants first.`, 400);
        }
        // Safe to delete beds and room
        await Bed_1.Bed.deleteMany({ room: room._id });
        await Room_1.Room.deleteOne({ _id: room._id });
        res.status(200).json({
            success: true,
            message: `Room ${room.roomNumber} and its beds have been deleted successfully`,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.deleteRoom = deleteRoom;
const addBedToRoom = async (req, res, next) => {
    try {
        const { roomId } = req.params;
        const orgId = req.orgId;
        if (!roomId || !mongoose_1.default.Types.ObjectId.isValid(roomId)) {
            throw new errorHandler_1.AppError('Invalid room ID format', 400);
        }
        const room = await Room_1.Room.findOne({ _id: roomId, organization: orgId });
        if (!room) {
            throw new errorHandler_1.AppError('Room not found or does not belong to your organization', 404);
        }
        // Check subscription quota
        const sub = await Subscription_1.Subscription.findOne({ organization: orgId });
        if (sub) {
            const currentBedCount = await Bed_1.Bed.countDocuments({ organization: orgId });
            if (currentBedCount >= sub.maxBeds) {
                throw new errorHandler_1.AppError(`Subscription limit reached: You have reached your ${sub.plan.toUpperCase()} plan quota of ${sub.maxBeds} beds. Please upgrade your subscription to add more beds.`, 403, 'PLAN_LIMIT_REACHED');
            }
        }
        const input = property_validator_1.addBedSchema.parse(req.body);
        // Determine next bed number if not provided
        let bedNumber = input.bedNumber?.trim();
        if (!bedNumber) {
            const existingBeds = await Bed_1.Bed.find({ room: room._id });
            const existingBedNumbers = new Set(existingBeds.map(b => b.bedNumber.trim()));
            let idx = existingBeds.length;
            while (!bedNumber || existingBedNumbers.has(bedNumber)) {
                bedNumber = `${room.roomNumber}-${(0, exports.getBedSuffix)(idx)}`;
                idx++;
            }
        }
        else {
            const duplicate = await Bed_1.Bed.findOne({
                room: room._id,
                bedNumber: { $regex: new RegExp(`^${bedNumber}$`, 'i') },
            });
            if (duplicate) {
                throw new errorHandler_1.AppError(`Bed "${bedNumber}" already exists in Room ${room.roomNumber}`, 409);
            }
        }
        const newBed = await Bed_1.Bed.create({
            organization: orgId,
            property: room.property,
            room: room._id,
            bedNumber,
            status: 'available',
        });
        // Update room sharing type count
        const totalBedsInRoom = await Bed_1.Bed.countDocuments({ room: room._id });
        room.sharingType = totalBedsInRoom;
        await room.save();
        res.status(201).json({
            success: true,
            message: `Bed ${bedNumber} added successfully to Room ${room.roomNumber}`,
            data: newBed,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.addBedToRoom = addBedToRoom;
// ==========================================
// VISUAL BED MATRIX CONTROLLER
// ==========================================
const getPropertyMatrix = async (req, res, next) => {
    try {
        const { id: propertyId } = req.params;
        const orgId = req.orgId;
        if (!propertyId || !mongoose_1.default.Types.ObjectId.isValid(propertyId)) {
            throw new errorHandler_1.AppError('Invalid property ID format', 400);
        }
        const property = await Property_1.Property.findOne({ _id: propertyId, organization: orgId });
        if (!property) {
            throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
        }
        // Fetch all rooms sorted by floor and room number
        const rooms = await Room_1.Room.find({ property: property._id, organization: orgId }).sort({
            floorNumber: 1,
            roomNumber: 1,
        });
        // Fetch all beds for this property
        const beds = await Bed_1.Bed.find({ property: property._id, organization: orgId })
            .populate('currentTenant', 'fullName phone monthlyRentPaise status kycDocUrl kycDocType kycMaskedNumber')
            .sort({ bedNumber: 1 });
        // Map beds by room ID
        const bedsByRoom = new Map();
        beds.forEach(bed => {
            const rId = bed.room.toString();
            const existing = bedsByRoom.get(rId) || [];
            existing.push(bed);
            bedsByRoom.set(rId, existing);
        });
        // Group rooms by floor
        const floorsMap = new Map();
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
    }
    catch (error) {
        next(error);
    }
};
exports.getPropertyMatrix = getPropertyMatrix;
