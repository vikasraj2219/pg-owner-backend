"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteReading = exports.updateReading = exports.getLatestRoomReading = exports.getReadings = exports.recordReading = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const errorHandler_1 = require("../middleware/errorHandler");
const models_1 = require("../models");
const meter_validator_1 = require("../validators/meter.validator");
/**
 * Record a sub-meter electricity reading and compute room tenant split
 * POST /api/meters/reading
 */
const recordReading = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        const userId = req.user?.id;
        const validated = meter_validator_1.createMeterReadingSchema.parse(req.body);
        const { propertyId, roomId, meterIdentifier, previousReading, currentReading, ratePaisePerUnit, readingDate, photoUrl, splitMethod, } = validated;
        const property = await models_1.Property.findOne({ _id: propertyId, organization: orgId });
        if (!property) {
            throw new errorHandler_1.AppError('Property not found or does not belong to your organization', 404);
        }
        const room = await models_1.Room.findOne({ _id: roomId, property: propertyId, organization: orgId });
        if (!room) {
            throw new errorHandler_1.AppError('Room not found or does not belong to this property', 404);
        }
        const unitsConsumed = currentReading - previousReading;
        const effectiveRatePaise = ratePaisePerUnit ?? property.electricityRatePaisePerUnit ?? 0;
        const totalAmountPaise = Math.round(unitsConsumed * effectiveRatePaise);
        // Find all active tenants in this room
        const activeAssignments = await models_1.BedAssignment.find({
            room: roomId,
            organization: orgId,
            status: 'active',
        });
        const tenantSplits = [];
        if (activeAssignments.length > 0 && totalAmountPaise > 0) {
            if (splitMethod === 'by_days_occupied') {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const occupantDays = activeAssignments.map(as => {
                    const checkin = new Date(as.startDate);
                    const effectiveStart = checkin > startOfMonth ? checkin : startOfMonth;
                    const days = Math.max(1, Math.ceil((now.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
                    return { tenant: as.tenant, days };
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
            }
            else {
                // Equal split
                const count = activeAssignments.length;
                const baseShare = Math.floor(totalAmountPaise / count);
                let remainder = totalAmountPaise % count;
                activeAssignments.forEach(as => {
                    const share = baseShare + (remainder > 0 ? 1 : 0);
                    if (remainder > 0)
                        remainder--;
                    tenantSplits.push({
                        tenant: as.tenant,
                        daysOccupied: 30,
                        sharePaise: share,
                    });
                });
            }
        }
        const reading = await models_1.MeterReading.create({
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
            recordedBy: userId ? new mongoose_1.default.Types.ObjectId(userId) : undefined,
        });
        res.status(201).json({
            success: true,
            message: `Meter reading recorded. ${unitsConsumed} units consumed (₹${(totalAmountPaise / 100).toFixed(2)}) split across ${tenantSplits.length} tenant(s).`,
            data: reading,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.recordReading = recordReading;
/**
 * List meter readings
 * GET /api/meters/readings
 */
const getReadings = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        const { propertyId, roomId } = req.query;
        const query = { organization: orgId };
        if (propertyId &&
            typeof propertyId === 'string' &&
            mongoose_1.default.Types.ObjectId.isValid(propertyId)) {
            query.property = propertyId;
        }
        if (roomId && typeof roomId === 'string' && mongoose_1.default.Types.ObjectId.isValid(roomId)) {
            query.room = roomId;
        }
        const readings = await models_1.MeterReading.find(query)
            .populate('property', 'name code')
            .populate('room', 'roomNumber floorNumber')
            .populate('tenantSplits.tenant', 'fullName phone')
            .sort({ readingDate: -1 });
        res.status(200).json({
            success: true,
            data: readings,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getReadings = getReadings;
/**
 * Get latest meter reading for a specific room to pre-fill previous reading
 * GET /api/meters/room/:roomId/latest
 */
const getLatestRoomReading = async (req, res, next) => {
    try {
        const { roomId } = req.params;
        const orgId = req.orgId;
        if (!roomId || !mongoose_1.default.Types.ObjectId.isValid(roomId)) {
            throw new errorHandler_1.AppError('Invalid room ID format', 400);
        }
        const latest = await models_1.MeterReading.findOne({ room: roomId, organization: orgId }).sort({
            readingDate: -1,
        });
        res.status(200).json({
            success: true,
            data: latest,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getLatestRoomReading = getLatestRoomReading;
/**
 * Update an existing meter reading and recalculate tenant splits
 * PUT /api/meters/reading/:id
 */
const updateReading = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid meter reading ID format', 400);
        }
        const reading = await models_1.MeterReading.findOne({ _id: id, organization: orgId });
        if (!reading) {
            throw new errorHandler_1.AppError('Meter reading not found', 404);
        }
        const validated = meter_validator_1.updateMeterReadingSchema.parse(req.body);
        const prevReading = validated.previousReading !== undefined ? validated.previousReading : reading.previousReading;
        const currReading = validated.currentReading !== undefined ? validated.currentReading : reading.currentReading;
        if (currReading < prevReading) {
            throw new errorHandler_1.AppError(`Current reading (${currReading}) cannot be lower than previous reading (${prevReading})`, 400);
        }
        const property = await models_1.Property.findOne({ _id: reading.property, organization: orgId });
        const effectiveRatePaise = validated.ratePaisePerUnit ??
            reading.ratePaisePerUnit ??
            property?.electricityRatePaisePerUnit ??
            0;
        const splitMethod = validated.splitMethod ?? reading.splitMethod;
        const unitsConsumed = currReading - prevReading;
        const totalAmountPaise = Math.round(unitsConsumed * effectiveRatePaise);
        // Recalculate tenant splits
        const activeAssignments = await models_1.BedAssignment.find({
            room: reading.room,
            organization: orgId,
            status: 'active',
        });
        const tenantSplits = [];
        if (activeAssignments.length > 0 && totalAmountPaise > 0) {
            if (splitMethod === 'by_days_occupied') {
                const now = reading.readingDate || new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const occupantDays = activeAssignments.map(as => {
                    const checkin = new Date(as.startDate);
                    const effectiveStart = checkin > startOfMonth ? checkin : startOfMonth;
                    const days = Math.max(1, Math.ceil((now.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
                    return { tenant: as.tenant, days };
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
            }
            else {
                const count = activeAssignments.length;
                const baseShare = Math.floor(totalAmountPaise / count);
                let remainder = totalAmountPaise % count;
                activeAssignments.forEach(as => {
                    const share = baseShare + (remainder > 0 ? 1 : 0);
                    if (remainder > 0)
                        remainder--;
                    tenantSplits.push({
                        tenant: as.tenant,
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
        reading.tenantSplits = tenantSplits;
        if (validated.readingDate)
            reading.readingDate = new Date(validated.readingDate);
        if (validated.photoUrl !== undefined)
            reading.photoUrl = validated.photoUrl;
        await reading.save();
        res.status(200).json({
            success: true,
            message: 'Meter reading updated successfully',
            data: reading,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateReading = updateReading;
/**
 * Delete a meter reading
 * DELETE /api/meters/reading/:id
 */
const deleteReading = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid meter reading ID format', 400);
        }
        const reading = await models_1.MeterReading.findOneAndDelete({ _id: id, organization: orgId });
        if (!reading) {
            throw new errorHandler_1.AppError('Meter reading not found', 404);
        }
        res.status(200).json({
            success: true,
            message: 'Meter reading deleted successfully',
        });
    }
    catch (error) {
        next(error);
    }
};
exports.deleteReading = deleteReading;
