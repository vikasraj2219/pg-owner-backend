"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteReading = exports.updateReading = exports.getLatestRoomReading = exports.getReadings = exports.recordReading = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const errorHandler_1 = require("../middleware/errorHandler");
const models_1 = require("../models");
const invoiceNumber_service_1 = require("../services/invoiceNumber.service");
const meter_validator_1 = require("../validators/meter.validator");
/**
 * Helper to retrieve all current room occupants including both active tenants
 * and tenants currently serving notice_period on occupied beds.
 */
async function getRoomOccupants(roomId, orgId) {
    // 1. Find all occupied and notice-period beds in this room
    const occupiedBeds = await models_1.Bed.find({
        room: roomId,
        organization: orgId,
        status: { $in: ['occupied', 'notice_period'] },
        currentTenant: { $exists: true, $ne: null },
    });
    // 2. Find active and notice bed assignments in this room
    const activeAssignments = await models_1.BedAssignment.find({
        room: roomId,
        organization: orgId,
        status: { $in: ['active', 'notice_period', 'notice'] },
    });
    // 3. Merge unique tenant IDs and retain check-in / start dates
    const occupantMap = new Map();
    for (const b of occupiedBeds) {
        if (b.currentTenant) {
            const tId = b.currentTenant.toString();
            occupantMap.set(tId, { tenantId: b.currentTenant });
        }
    }
    for (const as of activeAssignments) {
        if (as.tenant) {
            const tId = as.tenant.toString();
            const existing = occupantMap.get(tId);
            if (existing) {
                if (!existing.startDate || (as.startDate && as.startDate < existing.startDate)) {
                    existing.startDate = as.startDate;
                }
            }
            else {
                occupantMap.set(tId, {
                    tenantId: as.tenant,
                    startDate: as.startDate,
                });
            }
        }
    }
    // 4. Verify against Tenant collection: must not be checked out or soft-deleted
    const candidateIds = Array.from(occupantMap.values()).map(o => o.tenantId);
    if (candidateIds.length === 0)
        return [];
    const validTenants = await models_1.Tenant.find({
        _id: { $in: candidateIds },
        organization: orgId,
        status: { $in: ['active', 'notice_period'] },
        isDeleted: { $ne: true },
    });
    const validSet = new Set(validTenants.map(t => t._id.toString()));
    return Array.from(occupantMap.values())
        .filter(o => validSet.has(o.tenantId.toString()))
        .map(o => {
        const matchingTenant = validTenants.find(t => t._id.toString() === o.tenantId.toString());
        return {
            tenantId: o.tenantId,
            startDate: o.startDate || matchingTenant?.joinDate || matchingTenant?.createdAt,
        };
    });
}
/**
 * Synchronize tenant meter splits with the Invoice collection.
 * Creates or updates an electricity line item for each tenant split in the corresponding billing cycle.
 */
async function syncMeterReadingToInvoices(reading, orgId) {
    const readingDate = reading.readingDate ? new Date(reading.readingDate) : new Date();
    const invMonth = readingDate.getMonth() + 1;
    const invYear = readingDate.getFullYear();
    const identifier = reading.meterIdentifier || 'Sub-meter';
    const itemTag = `[MTR:${reading._id.toString()}]`;
    const ebDesc = `Electricity: ${identifier} (${reading.unitsConsumed}u @ ₹${(reading.ratePaisePerUnit / 100).toFixed(1)}/u) ${itemTag}`;
    for (const split of reading.tenantSplits || []) {
        if (!split.tenant)
            continue;
        const tenantId = split.tenant._id || split.tenant;
        let invoice = await models_1.Invoice.findOne({
            organization: orgId,
            tenant: tenantId,
            month: invMonth,
            year: invYear,
        });
        if (split.sharePaise > 0) {
            if (invoice) {
                // Find if this reading's electricity line item is already present
                const existingIdx = invoice.items.findIndex(it => it.category === 'electricity' &&
                    (it.description.includes(itemTag) ||
                        it.description.includes(`Electricity: ${identifier}`)));
                const existingItem = existingIdx >= 0 ? invoice.items[existingIdx] : undefined;
                if (existingItem) {
                    existingItem.description = ebDesc;
                    existingItem.amountPaise = split.sharePaise;
                }
                else {
                    invoice.items.push({
                        description: ebDesc,
                        amountPaise: split.sharePaise,
                        category: 'electricity',
                    });
                }
                const newTotal = invoice.items.reduce((sum, it) => sum + it.amountPaise, 0);
                invoice.totalAmountPaise = newTotal;
                invoice.balanceDuePaise = Math.max(0, newTotal - invoice.amountPaidPaise);
                if (invoice.balanceDuePaise === 0 && invoice.totalAmountPaise > 0) {
                    invoice.status = 'paid';
                }
                else if (invoice.amountPaidPaise > 0) {
                    invoice.status = 'partially_paid';
                }
                else {
                    invoice.status = 'unpaid';
                }
                await invoice.save();
                split.invoice = invoice._id;
            }
            else {
                // Generate a new invoice for this tenant for electricity
                const invNum = await (0, invoiceNumber_service_1.generateInvoiceNumber)(orgId.toString(), invYear, invMonth);
                const newInvoice = await models_1.Invoice.create({
                    organization: orgId,
                    property: reading.property,
                    tenant: tenantId,
                    invoiceNumber: invNum,
                    month: invMonth,
                    year: invYear,
                    dueDate: readingDate,
                    items: [
                        {
                            description: ebDesc,
                            amountPaise: split.sharePaise,
                            category: 'electricity',
                        },
                    ],
                    totalAmountPaise: split.sharePaise,
                    amountPaidPaise: 0,
                    balanceDuePaise: split.sharePaise,
                    status: 'unpaid',
                });
                split.invoice = newInvoice._id;
            }
        }
        else if (invoice) {
            // 0 split amount -> remove this reading's line item if previously added
            const existingIdx = invoice.items.findIndex(it => it.category === 'electricity' &&
                (it.description.includes(itemTag) ||
                    it.description.includes(`Electricity: ${identifier}`)));
            if (existingIdx >= 0) {
                invoice.items.splice(existingIdx, 1);
                if (invoice.items.length === 0 && invoice.amountPaidPaise === 0) {
                    await models_1.Invoice.deleteOne({ _id: invoice._id, organization: orgId });
                    split.invoice = undefined;
                }
                else {
                    const newTotal = invoice.items.reduce((sum, it) => sum + it.amountPaise, 0);
                    invoice.totalAmountPaise = newTotal;
                    invoice.balanceDuePaise = Math.max(0, newTotal - invoice.amountPaidPaise);
                    if (invoice.balanceDuePaise === 0 && invoice.totalAmountPaise > 0) {
                        invoice.status = 'paid';
                    }
                    else if (invoice.amountPaidPaise > 0) {
                        invoice.status = 'partially_paid';
                    }
                    else {
                        invoice.status = 'unpaid';
                    }
                    await invoice.save();
                }
            }
        }
    }
}
/**
 * Remove electricity charges associated with a deleted meter reading from tenant invoices.
 */
async function removeMeterReadingFromInvoices(reading, orgId) {
    const itemTag = `[MTR:${reading._id.toString()}]`;
    const identifier = reading.meterIdentifier || 'Sub-meter';
    for (const split of reading.tenantSplits || []) {
        if (!split.tenant)
            continue;
        const tenantId = split.tenant._id || split.tenant;
        const invoice = await models_1.Invoice.findOne({
            organization: orgId,
            $or: [
                { _id: split.invoice },
                {
                    tenant: tenantId,
                    'items.description': { $regex: reading._id.toString() },
                },
            ],
        });
        if (invoice) {
            const idx = invoice.items.findIndex(it => it.category === 'electricity' &&
                (it.description.includes(itemTag) ||
                    it.description.includes(`Electricity: ${identifier}`)));
            if (idx >= 0) {
                invoice.items.splice(idx, 1);
                if (invoice.items.length === 0 && invoice.amountPaidPaise === 0) {
                    await models_1.Invoice.deleteOne({ _id: invoice._id, organization: orgId });
                }
                else {
                    const newTotal = invoice.items.reduce((sum, it) => sum + it.amountPaise, 0);
                    invoice.totalAmountPaise = newTotal;
                    invoice.balanceDuePaise = Math.max(0, newTotal - invoice.amountPaidPaise);
                    if (invoice.balanceDuePaise === 0 && invoice.totalAmountPaise > 0) {
                        invoice.status = 'paid';
                    }
                    else if (invoice.amountPaidPaise > 0) {
                        invoice.status = 'partially_paid';
                    }
                    else {
                        invoice.status = 'unpaid';
                    }
                    await invoice.save();
                }
            }
        }
    }
}
/**
 * Record a sub-meter electricity reading and compute room tenant split
 * POST /api/meters/reading
 */
const recordReading = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
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
        // Find all active & notice occupants in this room
        const roomOccupants = await getRoomOccupants(roomId, orgId);
        const tenantSplits = [];
        if (roomOccupants.length > 0 && totalAmountPaise > 0) {
            if (splitMethod === 'by_days_occupied') {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const occupantDays = roomOccupants.map(as => {
                    const checkin = as.startDate ? new Date(as.startDate) : startOfMonth;
                    const effectiveStart = checkin > startOfMonth ? checkin : startOfMonth;
                    const days = Math.max(1, Math.ceil((now.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
                    return { tenant: as.tenantId, days };
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
                const count = roomOccupants.length;
                const baseShare = Math.floor(totalAmountPaise / count);
                let remainder = totalAmountPaise % count;
                roomOccupants.forEach(as => {
                    const share = baseShare + (remainder > 0 ? 1 : 0);
                    if (remainder > 0)
                        remainder--;
                    tenantSplits.push({
                        tenant: as.tenantId,
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
        // Synchronize electricity line items with monthly invoices for room occupants
        await syncMeterReadingToInvoices(reading, orgId);
        await reading.save();
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
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
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
        // Recalculate tenant splits across active & notice occupants
        const roomOccupants = await getRoomOccupants(reading.room, orgId);
        const tenantSplits = [];
        if (roomOccupants.length > 0 && totalAmountPaise > 0) {
            if (splitMethod === 'by_days_occupied') {
                const now = reading.readingDate || new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const occupantDays = roomOccupants.map(as => {
                    const checkin = as.startDate ? new Date(as.startDate) : startOfMonth;
                    const effectiveStart = checkin > startOfMonth ? checkin : startOfMonth;
                    const days = Math.max(1, Math.ceil((now.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
                    return { tenant: as.tenantId, days };
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
                const count = roomOccupants.length;
                const baseShare = Math.floor(totalAmountPaise / count);
                let remainder = totalAmountPaise % count;
                roomOccupants.forEach(as => {
                    const share = baseShare + (remainder > 0 ? 1 : 0);
                    if (remainder > 0)
                        remainder--;
                    tenantSplits.push({
                        tenant: as.tenantId,
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
        // Synchronize updated electricity line items with monthly invoices for room occupants
        await syncMeterReadingToInvoices(reading, orgId);
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
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid meter reading ID format', 400);
        }
        const reading = await models_1.MeterReading.findOne({ _id: id, organization: orgId });
        if (!reading) {
            throw new errorHandler_1.AppError('Meter reading not found', 404);
        }
        // Remove electricity line items from tenant invoices
        await removeMeterReadingFromInvoices(reading, orgId);
        await models_1.MeterReading.deleteOne({ _id: id, organization: orgId });
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
