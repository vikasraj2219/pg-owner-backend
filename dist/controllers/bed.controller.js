"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteBed = exports.updateBed = exports.updateBedStatus = exports.getBedById = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const property_validator_1 = require("../validators/property.validator");
const Bed_1 = require("../models/Bed");
const Room_1 = require("../models/Room");
const Tenant_1 = require("../models/Tenant");
const BedAssignment_1 = require("../models/BedAssignment");
const Invoice_1 = require("../models/Invoice");
const errorHandler_1 = require("../middleware/errorHandler");
const getBedById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid bed ID format', 400);
        }
        const bed = await Bed_1.Bed.findOne({ _id: id, organization: orgId })
            .populate('room', 'roomNumber floorNumber sharingType baseRentPaisePerBed tags')
            .populate('property', 'name type upiVpa electricityRatePaisePerUnit')
            .populate('currentTenant', 'fullName phone monthlyRentPaise status');
        if (!bed) {
            throw new errorHandler_1.AppError('Bed not found or does not belong to your organization', 404);
        }
        res.status(200).json({
            success: true,
            data: bed,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getBedById = getBedById;
const updateBedStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid bed ID format', 400);
        }
        const input = property_validator_1.updateBedStatusSchema.parse(req.body);
        const bed = await Bed_1.Bed.findOne({ _id: id, organization: orgId });
        if (!bed) {
            throw new errorHandler_1.AppError('Bed not found or does not belong to your organization', 404);
        }
        // Guard: Do not manually set to available if currently occupied by active tenant
        if (bed.status === 'occupied' && input.status === 'available' && bed.currentTenant) {
            throw new errorHandler_1.AppError('Cannot directly set an occupied bed to available while a tenant is assigned. Please use the checkout settlement process.', 400);
        }
        bed.status = input.status;
        if (input.status === 'maintenance') {
            bed.maintenanceNote = input.maintenanceNote || 'Under maintenance';
        }
        else if (input.status === 'available') {
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
    }
    catch (error) {
        next(error);
    }
};
exports.updateBedStatus = updateBedStatus;
const updateBed = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid bed ID format', 400);
        }
        const input = property_validator_1.updateBedSchema.parse(req.body);
        const bed = await Bed_1.Bed.findOne({ _id: id, organization: orgId });
        if (!bed) {
            throw new errorHandler_1.AppError('Bed not found or does not belong to your organization', 404);
        }
        // Check duplicate bedNumber if updating
        if (input.bedNumber && input.bedNumber.trim() !== bed.bedNumber) {
            const duplicate = await Bed_1.Bed.findOne({
                _id: { $ne: bed._id },
                room: bed.room,
                bedNumber: { $regex: new RegExp(`^${input.bedNumber.trim()}$`, 'i') },
            });
            if (duplicate) {
                throw new errorHandler_1.AppError(`Bed label "${input.bedNumber}" already exists in this room`, 409);
            }
            bed.bedNumber = input.bedNumber.trim();
        }
        if (input.baseRentPaise !== undefined) {
            bed.baseRentPaise = input.baseRentPaise;
            // If the bed is occupied and rent changed, keep tenant, active assignment & unpaid invoice in sync
            if (bed.currentTenant) {
                await Tenant_1.Tenant.updateOne({ _id: bed.currentTenant, organization: orgId }, { monthlyRentPaise: input.baseRentPaise });
                await BedAssignment_1.BedAssignment.updateMany({ bed: bed._id, status: 'active', organization: orgId }, { monthlyRentPaise: input.baseRentPaise });
                // Also update any current unpaid invoice
                const unpaidInvoice = await Invoice_1.Invoice.findOne({
                    tenant: bed.currentTenant,
                    organization: orgId,
                    status: 'unpaid',
                }).sort({ createdAt: -1 });
                if (unpaidInvoice) {
                    const rentItem = unpaidInvoice.items.find(it => it.category === 'rent');
                    if (rentItem) {
                        rentItem.amountPaise = input.baseRentPaise;
                        unpaidInvoice.totalAmountPaise = unpaidInvoice.items.reduce((acc, it) => acc + it.amountPaise, 0);
                        unpaidInvoice.balanceDuePaise = Math.max(0, unpaidInvoice.totalAmountPaise - unpaidInvoice.amountPaidPaise);
                        await unpaidInvoice.save();
                    }
                }
            }
        }
        if (input.status) {
            if (bed.status === 'occupied' && input.status === 'available' && bed.currentTenant) {
                throw new errorHandler_1.AppError('Cannot directly set an occupied bed to available while a tenant is assigned. Please use the checkout settlement process.', 400);
            }
            bed.status = input.status;
            if (input.status === 'maintenance') {
                bed.maintenanceNote = input.maintenanceNote || 'Under maintenance';
            }
            else if (input.status === 'available') {
                bed.maintenanceNote = undefined;
                bed.noticeEndDate = undefined;
            }
            if (input.status === 'notice_period' && input.noticeEndDate) {
                bed.noticeEndDate = new Date(input.noticeEndDate);
            }
        }
        else if (input.maintenanceNote !== undefined && bed.status === 'maintenance') {
            bed.maintenanceNote = input.maintenanceNote;
        }
        await bed.save();
        res.status(200).json({
            success: true,
            message: `Bed ${bed.bedNumber} updated successfully`,
            data: bed,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateBed = updateBed;
const deleteBed = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid bed ID format', 400);
        }
        const bed = await Bed_1.Bed.findOne({ _id: id, organization: orgId });
        if (!bed) {
            throw new errorHandler_1.AppError('Bed not found or does not belong to your organization', 404);
        }
        if (bed.status === 'occupied' || bed.status === 'notice_period' || bed.currentTenant) {
            throw new errorHandler_1.AppError(`Cannot delete Bed ${bed.bedNumber} because it is currently occupied or on notice. Please check out or relocate the tenant first.`, 400);
        }
        const roomId = bed.room;
        await Bed_1.Bed.deleteOne({ _id: bed._id });
        if (roomId) {
            const remainingBeds = await Bed_1.Bed.countDocuments({ room: roomId });
            await Room_1.Room.findByIdAndUpdate(roomId, { sharingType: Math.max(1, remainingBeds) });
        }
        res.status(200).json({
            success: true,
            message: `Bed ${bed.bedNumber} deleted successfully`,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.deleteBed = deleteBed;
