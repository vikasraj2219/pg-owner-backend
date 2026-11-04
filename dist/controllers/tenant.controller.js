"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreTenant = exports.deleteTenant = exports.moveBed = exports.updateTenant = exports.cancelNoticePeriod = exports.setNoticePeriod = exports.vacateTenant = exports.getTenantById = exports.getTenants = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Tenant_1 = require("../models/Tenant");
const Invoice_1 = require("../models/Invoice");
const DepositLedger_1 = require("../models/DepositLedger");
const BedAssignment_1 = require("../models/BedAssignment");
const Bed_1 = require("../models/Bed");
const Payment_1 = require("../models/Payment");
const errorHandler_1 = require("../middleware/errorHandler");
const getTenants = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        const filter = {
            organization: orgId,
            isDeleted: { $ne: true },
        };
        if (req.query.propertyId) {
            if (!mongoose_1.default.Types.ObjectId.isValid(req.query.propertyId)) {
                throw new errorHandler_1.AppError('Invalid propertyId format', 400);
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
        const tenants = await Tenant_1.Tenant.find(filter)
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
        // Aggregate balance dues and active/notice bed assignment details
        const tenantIds = tenants.map(t => t._id);
        const unpaidInvoices = await Invoice_1.Invoice.find({
            organization: orgId,
            tenant: { $in: tenantIds },
            status: { $in: ['unpaid', 'partially_paid'] },
        }).select('tenant balanceDuePaise status dueDate');
        const dueMap = {};
        for (const inv of unpaidInvoices) {
            const tId = String(inv.tenant);
            if (!dueMap[tId]) {
                dueMap[tId] = { balanceDuePaise: 0, overdueCount: 0 };
            }
            dueMap[tId].balanceDuePaise += inv.balanceDuePaise || 0;
            if (inv.dueDate && new Date(inv.dueDate) < new Date()) {
                dueMap[tId].overdueCount += 1;
            }
        }
        const enhancedTenants = tenants.map(t => {
            const tenantObj = t.toObject ? t.toObject() : t;
            const dues = dueMap[String(t._id)] || { balanceDuePaise: 0, overdueCount: 0 };
            return {
                ...tenantObj,
                balanceDuePaise: dues.balanceDuePaise,
                hasOverdue: dues.overdueCount > 0,
            };
        });
        res.status(200).json({
            success: true,
            count: enhancedTenants.length,
            data: enhancedTenants,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getTenants = getTenants;
const getTenantById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
        }
        const tenant = await Tenant_1.Tenant.findOne({ _id: id, organization: orgId })
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
            throw new errorHandler_1.AppError('Tenant not found or does not belong to your organization', 404);
        }
        // Fetch tenant's recent invoices, deposits, bed assignments, and payments
        const [invoices, deposits, bedHistory, payments] = await Promise.all([
            Invoice_1.Invoice.find({ tenant: tenant._id, organization: orgId }).sort({ year: -1, month: -1 }),
            DepositLedger_1.DepositLedger.find({ tenant: tenant._id, organization: orgId }).sort({ date: -1 }),
            BedAssignment_1.BedAssignment.find({ tenant: tenant._id, organization: orgId })
                .populate('bed', 'bedNumber')
                .populate('room', 'roomNumber floorNumber')
                .sort({ startDate: -1 }),
            Payment_1.Payment.find({ tenant: tenant._id, organization: orgId }).sort({ paymentDate: -1 }),
        ]);
        const balanceDuePaise = invoices
            .filter(i => i.status !== 'paid' && (i.balanceDuePaise ?? 0) > 0)
            .reduce((sum, i) => sum + (i.balanceDuePaise || 0), 0);
        res.status(200).json({
            success: true,
            data: {
                tenant,
                invoices,
                deposits,
                bedHistory,
                payments,
                balanceDuePaise,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getTenantById = getTenantById;
const vacateTenant = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        const userId = req.user?.id;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
        }
        const tenant = await Tenant_1.Tenant.findOne({ _id: id, organization: orgId });
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found or does not belong to your organization', 404);
        }
        const { deductionsPaise = 0, refundPaise = 0, paymentMethod = 'cash', notes = 'Checkout settlement', } = req.body;
        // 1. Release assigned bed if any
        if (tenant.currentBed) {
            const bed = await Bed_1.Bed.findOne({ _id: tenant.currentBed, organization: orgId });
            if (bed) {
                bed.status = 'available';
                bed.currentTenant = undefined;
                bed.noticeEndDate = undefined;
                bed.maintenanceNote = undefined;
                await bed.save();
            }
        }
        // 2. End bed assignment history
        await BedAssignment_1.BedAssignment.updateMany({ tenant: tenant._id, organization: orgId, status: 'active' }, { $set: { status: 'vacated', endDate: new Date(), notes } });
        // 3. Record refund in DepositLedger if refundPaise > 0
        if (refundPaise > 0) {
            await DepositLedger_1.DepositLedger.create({
                organization: orgId,
                property: tenant.property,
                tenant: tenant._id,
                amountPaise: refundPaise,
                type: 'refunded',
                paymentMethod,
                notes: `Checkout net deposit refund: ${notes}`,
                recordedBy: userId ? new mongoose_1.default.Types.ObjectId(userId) : undefined,
                date: new Date(),
            });
        }
        // 4. Record deductions if deductionsPaise > 0
        if (deductionsPaise > 0) {
            await DepositLedger_1.DepositLedger.create({
                organization: orgId,
                property: tenant.property,
                tenant: tenant._id,
                amountPaise: deductionsPaise,
                type: 'deducted',
                paymentMethod,
                notes: `Checkout damage/repair deduction: ${notes}`,
                recordedBy: userId ? new mongoose_1.default.Types.ObjectId(userId) : undefined,
                date: new Date(),
            });
        }
        // 5. Update tenant status to checked_out
        tenant.status = 'checked_out';
        tenant.currentBed = undefined;
        await tenant.save();
        res.status(200).json({
            success: true,
            message: `Tenant ${tenant.fullName} successfully vacated and settled.`,
            data: {
                tenantId: tenant._id,
                status: tenant.status,
                netRefundPaise: refundPaise,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.vacateTenant = vacateTenant;
/**
 * Mark tenant and bed on notice period
 * POST /api/tenants/:id/notice
 */
const setNoticePeriod = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        const { expectedVacateDate, notes } = req.body;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
        }
        if (!expectedVacateDate) {
            throw new errorHandler_1.AppError('expectedVacateDate is required', 400);
        }
        const tenant = await Tenant_1.Tenant.findOne({ _id: id, organization: orgId });
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found or does not belong to your organization', 404);
        }
        const vacateDate = new Date(expectedVacateDate);
        if (isNaN(vacateDate.getTime())) {
            throw new errorHandler_1.AppError('Invalid expectedVacateDate format', 400);
        }
        tenant.status = 'notice_period';
        await tenant.save();
        if (tenant.currentBed) {
            const bed = await Bed_1.Bed.findOne({ _id: tenant.currentBed, organization: orgId });
            if (bed) {
                bed.status = 'notice_period';
                bed.noticeEndDate = vacateDate;
                if (notes)
                    bed.maintenanceNote = notes;
                await bed.save();
            }
        }
        res.status(200).json({
            success: true,
            message: `Tenant ${tenant.fullName} put on notice period until ${vacateDate.toDateString()}`,
            data: {
                tenantId: tenant._id,
                status: tenant.status,
                noticeEndDate: vacateDate,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.setNoticePeriod = setNoticePeriod;
/**
 * Cancel notice period and restore active tenant / occupied bed status
 * POST /api/tenants/:id/cancel-notice
 */
const cancelNoticePeriod = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
        }
        const tenant = await Tenant_1.Tenant.findOne({ _id: id, organization: orgId });
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found or does not belong to your organization', 404);
        }
        tenant.status = 'active';
        await tenant.save();
        if (tenant.currentBed) {
            const bed = await Bed_1.Bed.findOne({ _id: tenant.currentBed, organization: orgId });
            if (bed) {
                bed.status = 'occupied';
                bed.noticeEndDate = undefined;
                await bed.save();
            }
        }
        res.status(200).json({
            success: true,
            message: `Notice period canceled for ${tenant.fullName}. Bed restored to occupied.`,
            data: {
                tenantId: tenant._id,
                status: tenant.status,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.cancelNoticePeriod = cancelNoticePeriod;
/**
 * Update tenant profile details
 * PUT /api/tenants/:id
 */
const updateTenant = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
        }
        const tenant = await Tenant_1.Tenant.findOne({
            _id: id,
            organization: orgId,
            isDeleted: { $ne: true },
        });
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found', 404);
        }
        const { fullName, phone, emergencyPhone, email, monthlyRentPaise, depositPaise, kycMaskedNumber, kycDocUrl, } = req.body;
        if (fullName !== undefined)
            tenant.fullName = fullName.trim();
        if (phone !== undefined)
            tenant.phone = phone.trim();
        if (emergencyPhone !== undefined)
            tenant.emergencyPhone = emergencyPhone?.trim();
        if (email !== undefined)
            tenant.email = email?.trim()?.toLowerCase();
        if (monthlyRentPaise !== undefined && monthlyRentPaise >= 0) {
            tenant.monthlyRentPaise = monthlyRentPaise;
        }
        if (depositPaise !== undefined && depositPaise >= 0) {
            tenant.depositPaise = depositPaise;
        }
        if (kycMaskedNumber !== undefined)
            tenant.kycMaskedNumber = kycMaskedNumber;
        if (kycDocUrl !== undefined)
            tenant.kycDocUrl = kycDocUrl;
        await tenant.save();
        res.status(200).json({
            success: true,
            message: 'Tenant details updated successfully',
            data: tenant,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateTenant = updateTenant;
/**
 * Move tenant to another bed
 * POST /api/tenants/:id/move-bed
 */
const moveBed = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        const { newBedId, notes } = req.body;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
        }
        if (!newBedId || !mongoose_1.default.Types.ObjectId.isValid(newBedId)) {
            throw new errorHandler_1.AppError('Invalid newBedId format', 400);
        }
        const tenant = await Tenant_1.Tenant.findOne({
            _id: id,
            organization: orgId,
            isDeleted: { $ne: true },
        });
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found', 404);
        }
        const targetBed = await Bed_1.Bed.findOne({ _id: newBedId, organization: orgId }).populate('room');
        if (!targetBed) {
            throw new errorHandler_1.AppError('Target bed not found', 404);
        }
        if (targetBed.status !== 'available') {
            throw new errorHandler_1.AppError(`Target bed ${targetBed.bedNumber} is not available (current status: ${targetBed.status})`, 400);
        }
        // 1. Vacate old bed if assigned
        if (tenant.currentBed) {
            const oldBed = await Bed_1.Bed.findOne({ _id: tenant.currentBed, organization: orgId });
            if (oldBed) {
                oldBed.status = 'available';
                oldBed.currentTenant = undefined;
                oldBed.noticeEndDate = undefined;
                oldBed.maintenanceNote = undefined;
                await oldBed.save();
            }
            await BedAssignment_1.BedAssignment.updateMany({ tenant: tenant._id, bed: tenant.currentBed, status: 'active' }, {
                $set: {
                    status: 'transferred',
                    endDate: new Date(),
                    notes: notes || 'Transferred to another bed',
                },
            });
        }
        // 2. Assign target bed
        targetBed.status = tenant.status === 'notice_period' ? 'notice_period' : 'occupied';
        targetBed.currentTenant = tenant._id;
        await targetBed.save();
        tenant.currentBed = targetBed._id;
        await tenant.save();
        // 3. Create new active BedAssignment record
        await BedAssignment_1.BedAssignment.create({
            organization: orgId,
            property: tenant.property,
            room: targetBed.room?._id || targetBed.room,
            bed: targetBed._id,
            tenant: tenant._id,
            startDate: new Date(),
            status: 'active',
            notes: notes || 'Bed transfer',
        });
        res.status(200).json({
            success: true,
            message: `Tenant ${tenant.fullName} successfully moved to Bed ${targetBed.bedNumber}`,
            data: {
                tenantId: tenant._id,
                newBedId: targetBed._id,
                bedNumber: targetBed.bedNumber,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.moveBed = moveBed;
/**
 * Delete tenant or return can't delete warning if dues or bed assigned
 * DELETE /api/tenants/:id
 */
const deleteTenant = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
        }
        const tenant = await Tenant_1.Tenant.findOne({ _id: id, organization: orgId }).populate('currentBed');
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found', 404);
        }
        // Check if tenant is still occupying a bed or active/notice
        const hasBed = Boolean(tenant.currentBed);
        const isOccupied = tenant.status === 'active' || tenant.status === 'notice_period';
        // Calculate unpaid dues
        const unpaidInvoices = await Invoice_1.Invoice.find({
            organization: orgId,
            tenant: tenant._id,
            status: { $in: ['unpaid', 'partially_paid', 'overdue'] },
        });
        const balanceDuePaise = unpaidInvoices.reduce((sum, i) => sum + (i.balanceDuePaise || 0), 0);
        // If still in bed or has unpaid dues or active deposit:
        if (hasBed || isOccupied || balanceDuePaise > 0) {
            const bedNumber = tenant.currentBed?.bedNumber || 'assigned bed';
            res.status(400).json({
                success: false,
                canDelete: false,
                message: `${tenant.fullName} is still in Bed ${bedNumber} with ₹${(balanceDuePaise / 100).toLocaleString('en-IN')} due and a ₹${(tenant.depositPaise / 100).toLocaleString('en-IN')} deposit held. Check him out first to settle dues, then you can delete his record.`,
                data: {
                    tenantId: tenant._id,
                    bedNumber,
                    balanceDuePaise,
                    depositPaise: tenant.depositPaise,
                },
            });
            return;
        }
        // Tenant is settled / checked out -> soft delete
        tenant.isDeleted = true;
        tenant.deletedAt = new Date();
        await tenant.save();
        res.status(200).json({
            success: true,
            canDelete: true,
            message: `Tenant ${tenant.fullName} deleted successfully.`,
            data: {
                tenantId: tenant._id,
                fullName: tenant.fullName,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.deleteTenant = deleteTenant;
/**
 * Restore recently deleted tenant
 * POST /api/tenants/:id/restore
 */
const restoreTenant = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
        }
        const tenant = await Tenant_1.Tenant.findOne({ _id: id, organization: orgId });
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found', 404);
        }
        tenant.isDeleted = false;
        tenant.deletedAt = undefined;
        await tenant.save();
        res.status(200).json({
            success: true,
            message: `Tenant ${tenant.fullName} restored successfully.`,
            data: tenant,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.restoreTenant = restoreTenant;
