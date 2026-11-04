"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettlementStatementById = exports.getSettlementStatements = exports.confirmCheckout = exports.getCheckoutPreview = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const errorHandler_1 = require("../middleware/errorHandler");
const models_1 = require("../models");
const checkout_validator_1 = require("../validators/checkout.validator");
const settlementNumber_service_1 = require("../services/settlementNumber.service");
/**
 * Preview settlement calculations for a vacating tenant
 * GET /api/checkouts/preview/:tenantId
 */
const getCheckoutPreview = async (req, res, next) => {
    try {
        const { tenantId } = req.params;
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        if (!tenantId || !mongoose_1.default.Types.ObjectId.isValid(tenantId)) {
            throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
        }
        const tenant = await models_1.Tenant.findOne({ _id: tenantId, organization: orgId })
            .populate('property', 'name code upiVpa')
            .populate('currentBed', 'bedNumber room status');
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found or does not belong to your organization', 404);
        }
        // Active assignment
        const activeAssignment = await models_1.BedAssignment.findOne({
            tenant: tenant._id,
            organization: orgId,
            status: 'active',
        })
            .populate('room', 'roomNumber floorNumber')
            .populate('bed', 'bedNumber');
        // Fetch unpaid invoices
        const unpaidInvoices = await models_1.Invoice.find({
            tenant: tenant._id,
            organization: orgId,
            status: { $in: ['unpaid', 'partially_paid', 'overdue'] },
        }).sort({ dueDate: 1 });
        const unpaidDuesPaise = unpaidInvoices.reduce((sum, inv) => sum + inv.balanceDuePaise, 0);
        const depositPaidPaise = tenant.depositPaidPaise || tenant.depositPaise || 0;
        const netRefundPaise = Math.max(0, depositPaidPaise - unpaidDuesPaise);
        res.status(200).json({
            success: true,
            data: {
                tenant: {
                    _id: tenant._id,
                    fullName: tenant.fullName,
                    phone: tenant.phone,
                    status: tenant.status,
                    joinedDate: tenant.createdAt,
                    property: tenant.property,
                    currentBed: tenant.currentBed,
                    room: activeAssignment?.room,
                },
                depositPaidPaise,
                unpaidInvoices: unpaidInvoices.map(inv => ({
                    _id: inv._id,
                    invoiceNumber: inv.invoiceNumber,
                    month: inv.month,
                    year: inv.year,
                    totalAmountPaise: inv.totalAmountPaise,
                    amountPaidPaise: inv.amountPaidPaise,
                    balanceDuePaise: inv.balanceDuePaise,
                    dueDate: inv.dueDate,
                    status: inv.status,
                })),
                unpaidDuesPaise,
                estimatedRefundPaise: netRefundPaise,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getCheckoutPreview = getCheckoutPreview;
/**
 * Confirm checkout & settlement in an atomic transaction
 * POST /api/checkouts/confirm
 */
const confirmCheckout = async (req, res, next) => {
    const session = await mongoose_1.default.startSession();
    session.startTransaction();
    try {
        const orgId = req.orgId;
        const userId = req.user?.id;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        const validated = checkout_validator_1.checkoutConfirmSchema.parse(req.body);
        const { tenantId, damageDeductionsPaise, electricityDeductionsPaise, otherDeductionsPaise, paymentMethod, transactionReference, notes, } = validated;
        const tenant = await models_1.Tenant.findOne({ _id: tenantId, organization: orgId }).session(session);
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found or does not belong to your organization', 404);
        }
        if (tenant.status === 'checked_out') {
            throw new errorHandler_1.AppError('Tenant is already checked out', 400);
        }
        // Unpaid invoices
        const unpaidInvoices = await models_1.Invoice.find({
            tenant: tenant._id,
            organization: orgId,
            status: { $in: ['unpaid', 'partially_paid', 'overdue'] },
        }).session(session);
        const unpaidDuesPaise = unpaidInvoices.reduce((sum, inv) => sum + inv.balanceDuePaise, 0);
        const depositPaidPaise = tenant.depositPaidPaise || tenant.depositPaise || 0;
        const totalDeductionsPaise = unpaidDuesPaise + damageDeductionsPaise + electricityDeductionsPaise + otherDeductionsPaise;
        const calculatedRefundPaise = Math.max(0, depositPaidPaise - totalDeductionsPaise);
        const netRefundPaise = validated.refundPaise !== undefined ? validated.refundPaise : calculatedRefundPaise;
        // 1. Release Bed
        let freedBedId = undefined;
        let freedRoomId = undefined;
        if (tenant.currentBed) {
            const bed = await models_1.Bed.findOne({ _id: tenant.currentBed, organization: orgId }).session(session);
            if (bed) {
                freedBedId = bed._id;
                freedRoomId = bed.room;
                bed.status = 'available';
                bed.currentTenant = undefined;
                bed.noticeEndDate = undefined;
                bed.maintenanceNote = undefined;
                await bed.save({ session });
            }
        }
        // 2. Close active BedAssignment
        await models_1.BedAssignment.updateMany({ tenant: tenant._id, organization: orgId, status: 'active' }, { $set: { status: 'vacated', endDate: new Date(), notes: notes || 'Checkout completed' } }, { session });
        // 3. Generate sequential settlement number
        const settlementNumber = await (0, settlementNumber_service_1.generateSettlementNumber)(orgId);
        // 4. Create Settlement Statement
        const [settlement] = await models_1.SettlementStatement.create([
            {
                organization: orgId,
                property: tenant.property,
                tenant: tenant._id,
                bed: freedBedId,
                room: freedRoomId,
                settlementNumber,
                checkinDate: tenant.createdAt,
                checkoutDate: new Date(),
                depositPaidPaise,
                unpaidDuesPaise,
                damageDeductionsPaise,
                electricityDeductionsPaise,
                otherDeductionsPaise,
                totalDeductionsPaise,
                netRefundPaise,
                paymentMethod,
                transactionReference,
                notes,
                recordedBy: userId ? new mongoose_1.default.Types.ObjectId(userId) : undefined,
            },
        ], { session });
        // 5. Record DepositLedger entries
        if (netRefundPaise > 0) {
            await models_1.DepositLedger.create([
                {
                    organization: orgId,
                    property: tenant.property,
                    tenant: tenant._id,
                    amountPaise: netRefundPaise,
                    type: 'refunded',
                    paymentMethod,
                    notes: `Checkout refund [${settlementNumber}]: ${notes || 'Deposit refund'}`,
                    recordedBy: userId ? new mongoose_1.default.Types.ObjectId(userId) : undefined,
                    date: new Date(),
                },
            ], { session });
        }
        const totalNonDuesDeduction = damageDeductionsPaise + electricityDeductionsPaise + otherDeductionsPaise;
        if (totalNonDuesDeduction > 0) {
            await models_1.DepositLedger.create([
                {
                    organization: orgId,
                    property: tenant.property,
                    tenant: tenant._id,
                    amountPaise: totalNonDuesDeduction,
                    type: 'deducted',
                    paymentMethod,
                    notes: `Checkout deductions [${settlementNumber}] (Damage: ${damageDeductionsPaise}, EB: ${electricityDeductionsPaise}, Other: ${otherDeductionsPaise})`,
                    recordedBy: userId ? new mongoose_1.default.Types.ObjectId(userId) : undefined,
                    date: new Date(),
                },
            ], { session });
        }
        // 6. Mark unpaid invoices as settled if covered by deposit
        for (const inv of unpaidInvoices) {
            inv.amountPaidPaise = inv.totalAmountPaise;
            inv.balanceDuePaise = 0;
            inv.status = 'paid';
            await inv.save({ session });
        }
        // 7. Update tenant
        tenant.status = 'checked_out';
        tenant.currentBed = undefined;
        await tenant.save({ session });
        await session.commitTransaction();
        res.status(201).json({
            success: true,
            message: `Tenant ${tenant.fullName} successfully vacated and settlement generated.`,
            data: {
                settlement,
                tenantId: tenant._id,
                status: tenant.status,
            },
        });
    }
    catch (error) {
        await session.abortTransaction();
        next(error);
    }
    finally {
        session.endSession();
    }
};
exports.confirmCheckout = confirmCheckout;
/**
 * List settlement statements
 * GET /api/checkouts/statements
 */
const getSettlementStatements = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        const { propertyId } = req.query;
        const query = { organization: orgId };
        if (propertyId &&
            typeof propertyId === 'string' &&
            mongoose_1.default.Types.ObjectId.isValid(propertyId)) {
            query.property = propertyId;
        }
        const statements = await models_1.SettlementStatement.find(query)
            .populate('tenant', 'fullName phone')
            .populate('property', 'name code')
            .populate('bed', 'bedNumber')
            .sort({ checkoutDate: -1 });
        res.status(200).json({
            success: true,
            data: statements,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getSettlementStatements = getSettlementStatements;
/**
 * Get single settlement statement details
 * GET /api/checkouts/statements/:id
 */
const getSettlementStatementById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid settlement statement ID', 400);
        }
        const statement = await models_1.SettlementStatement.findOne({ _id: id, organization: orgId })
            .populate('tenant', 'fullName phone email kycData')
            .populate('property', 'name code address upiVpa')
            .populate('bed', 'bedNumber')
            .populate('room', 'roomNumber floorNumber')
            .populate('recordedBy', 'name');
        if (!statement) {
            throw new errorHandler_1.AppError('Settlement statement not found', 404);
        }
        res.status(200).json({
            success: true,
            data: statement,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getSettlementStatementById = getSettlementStatementById;
