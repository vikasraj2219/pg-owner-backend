"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPayments = exports.markInvoicePaid = exports.generateMonthlyInvoices = exports.getInvoiceById = exports.getInvoices = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Invoice_1 = require("../models/Invoice");
const Payment_1 = require("../models/Payment");
const Organization_1 = require("../models/Organization");
const BedAssignment_1 = require("../models/BedAssignment");
const errorHandler_1 = require("../middleware/errorHandler");
const invoiceNumber_service_1 = require("../services/invoiceNumber.service");
const receiptNumber_service_1 = require("../services/receiptNumber.service");
const proration_service_1 = require("../services/proration.service");
const invoice_validator_1 = require("../validators/invoice.validator");
const env_1 = require("../config/env");
const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];
/**
 * GET /api/invoices
 * List invoices with flexible filtering and overdue calculation scoped by organization
 */
const getInvoices = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        const org = await Organization_1.Organization.findById(orgId).select('settings');
        const gracePeriodDays = org?.settings?.gracePeriodDays ?? 5;
        const filter = { organization: orgId };
        if (req.query.propertyId) {
            if (!mongoose_1.default.Types.ObjectId.isValid(req.query.propertyId)) {
                throw new errorHandler_1.AppError('Invalid property ID format', 400);
            }
            filter.property = req.query.propertyId;
        }
        if (req.query.tenantId) {
            if (!mongoose_1.default.Types.ObjectId.isValid(req.query.tenantId)) {
                throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
            }
            filter.tenant = req.query.tenantId;
        }
        if (req.query.month) {
            filter.month = parseInt(req.query.month, 10);
        }
        if (req.query.year) {
            filter.year = parseInt(req.query.year, 10);
        }
        const statusParam = req.query.status;
        const now = new Date();
        if (statusParam === 'overdue') {
            filter.status = { $in: ['unpaid', 'partially_paid'] };
            // Due date + grace period has passed
            const overdueCutoff = new Date(now.getTime() - gracePeriodDays * 24 * 60 * 60 * 1000);
            filter.dueDate = { $lt: overdueCutoff };
        }
        else if (statusParam === 'unpaid') {
            filter.status = { $in: ['unpaid', 'partially_paid'] };
        }
        else if (statusParam === 'paid') {
            filter.status = 'paid';
        }
        const invoices = await Invoice_1.Invoice.find(filter)
            .populate('tenant', 'fullName phone currentBed status')
            .populate('property', 'name type address upiVpa')
            .sort({ dueDate: -1, createdAt: -1 });
        const search = req.query.search?.toLowerCase().trim();
        const formattedInvoices = invoices
            .map(inv => {
            const invObj = inv.toObject();
            const dueDate = new Date(inv.dueDate);
            const diffTime = now.getTime() - dueDate.getTime();
            const daysPastDue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            const isOverdue = inv.status !== 'paid' && daysPastDue > gracePeriodDays;
            const overdueDays = inv.status !== 'paid' && daysPastDue > 0 ? daysPastDue : 0;
            return {
                ...invObj,
                overdueDays,
                isOverdue,
            };
        })
            .filter(inv => {
            if (!search)
                return true;
            const tenantName = inv.tenant?.fullName?.toLowerCase() || '';
            const invNum = inv.invoiceNumber?.toLowerCase() || '';
            return tenantName.includes(search) || invNum.includes(search);
        });
        res.status(200).json({
            success: true,
            count: formattedInvoices.length,
            data: formattedInvoices,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getInvoices = getInvoices;
/**
 * GET /api/invoices/:id
 * Retrieve single invoice details with its payment history
 */
const getInvoiceById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid invoice ID format', 400);
        }
        const invoice = await Invoice_1.Invoice.findOne({ _id: id, organization: orgId })
            .populate('tenant', 'fullName phone currentBed status')
            .populate('property', 'name type address upiVpa');
        if (!invoice) {
            throw new errorHandler_1.AppError('Invoice not found or does not belong to your organization', 404);
        }
        const payments = await Payment_1.Payment.find({ invoice: invoice._id, organization: orgId }).sort({
            paymentDate: -1,
        });
        res.status(200).json({
            success: true,
            data: {
                ...invoice.toObject(),
                payments,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getInvoiceById = getInvoiceById;
/**
 * POST /api/invoices/generate-monthly
 * Idempotent monthly billing cron / trigger
 * Protected by x-cron-secret header OR authenticated organization session
 */
const generateMonthlyInvoices = async (req, res, next) => {
    try {
        const cronSecret = req.headers['x-cron-secret'];
        const authReq = req;
        const hasValidCronSecret = cronSecret && cronSecret === env_1.env.INTERNAL_CRON_SECRET;
        const orgId = authReq.orgId;
        if (!hasValidCronSecret && !orgId) {
            throw new errorHandler_1.AppError('Unauthorized: valid cron secret or organization authentication required', 401);
        }
        const parsed = invoice_validator_1.generateMonthlyInvoicesSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new errorHandler_1.AppError(parsed.error.errors[0]?.message || 'Invalid monthly invoice parameters', 400);
        }
        const now = new Date();
        const targetMonth = parsed.data.month ?? now.getMonth() + 1;
        const targetYear = parsed.data.year ?? now.getFullYear();
        const filterPropertyId = parsed.data.propertyId;
        // Determine target organizations
        let targetOrgIds = [];
        if (orgId) {
            targetOrgIds = [new mongoose_1.default.Types.ObjectId(orgId)];
        }
        else if (req.body.organizationId) {
            if (!mongoose_1.default.Types.ObjectId.isValid(req.body.organizationId)) {
                throw new errorHandler_1.AppError('Invalid organizationId format', 400);
            }
            targetOrgIds = [new mongoose_1.default.Types.ObjectId(req.body.organizationId)];
        }
        else {
            const allOrgs = await Organization_1.Organization.find().select('_id');
            targetOrgIds = allOrgs.map(o => o._id);
        }
        let generatedCount = 0;
        let skippedCount = 0;
        const monthName = `${MONTH_NAMES[targetMonth - 1]} ${targetYear}`;
        for (const targetId of targetOrgIds) {
            const org = await Organization_1.Organization.findById(targetId);
            if (!org)
                continue;
            const assignmentFilter = {
                organization: targetId,
                status: 'active',
            };
            if (filterPropertyId) {
                assignmentFilter.property = filterPropertyId;
            }
            const activeAssignments = await BedAssignment_1.BedAssignment.find(assignmentFilter).populate('tenant', 'fullName status billingCycleDay joinDate createdAt');
            for (const assignment of activeAssignments) {
                if (!assignment.tenant)
                    continue;
                const tenant = assignment.tenant;
                const tenantId = tenant._id;
                // Idempotency check: see if invoice already exists for this tenant in this month/year
                const existingInvoice = await Invoice_1.Invoice.findOne({
                    tenant: tenantId,
                    month: targetMonth,
                    year: targetYear,
                });
                if (existingInvoice) {
                    skippedCount++;
                    continue;
                }
                // Determine tenant's join date billing cycle
                const tenantJoinDate = tenant.joinDate || assignment.startDate || tenant.createdAt || new Date();
                const cycle = (0, proration_service_1.calculateJoinDateCycle)(new Date(tenantJoinDate), targetMonth, targetYear);
                const invoiceNumber = await (0, invoiceNumber_service_1.generateInvoiceNumber)(targetId.toString(), targetYear, targetMonth);
                const rentPaise = assignment.monthlyRentPaise;
                try {
                    await Invoice_1.Invoice.create({
                        organization: targetId,
                        property: assignment.property,
                        tenant: tenantId,
                        invoiceNumber,
                        month: targetMonth,
                        year: targetYear,
                        dueDate: cycle.periodStart, // Due on tenant's join date anniversary
                        periodStart: cycle.periodStart,
                        periodEnd: cycle.periodEnd,
                        items: [
                            {
                                description: cycle.description,
                                amountPaise: rentPaise,
                                category: 'rent',
                            },
                        ],
                        totalAmountPaise: rentPaise,
                        amountPaidPaise: 0,
                        balanceDuePaise: rentPaise,
                        status: 'unpaid',
                    });
                    generatedCount++;
                }
                catch (err) {
                    // Handle potential race condition on unique index { tenant: 1, month: 1, year: 1 }
                    if (err.code === 11000) {
                        skippedCount++;
                    }
                    else {
                        throw err;
                    }
                }
            }
        }
        res.status(200).json({
            success: true,
            message: `Monthly invoice generation finished for ${monthName}`,
            data: {
                month: targetMonth,
                year: targetYear,
                generatedCount,
                skippedCount,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.generateMonthlyInvoices = generateMonthlyInvoices;
/**
 * POST /api/invoices/:id/pay
 * Record partial or full payment for an invoice with receipt generation
 */
const markInvoicePaid = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        const userId = req.user?.id;
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid invoice ID format', 400);
        }
        const parsed = invoice_validator_1.markPaidSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new errorHandler_1.AppError(parsed.error.errors[0]?.message || 'Invalid monthly invoice parameters', 400);
        }
        const invoice = await Invoice_1.Invoice.findOne({ _id: id, organization: orgId });
        if (!invoice) {
            throw new errorHandler_1.AppError('Invoice not found or does not belong to your organization', 404);
        }
        if (invoice.status === 'paid' || invoice.balanceDuePaise === 0) {
            throw new errorHandler_1.AppError('This invoice is already fully paid', 400);
        }
        const { amountPaise, paymentMethod, transactionReference, notes } = parsed.data;
        const paymentAmount = amountPaise !== undefined ? amountPaise : invoice.balanceDuePaise;
        if (paymentAmount <= 0) {
            throw new errorHandler_1.AppError('Payment amount must be greater than 0', 400);
        }
        if (paymentAmount > invoice.balanceDuePaise) {
            throw new errorHandler_1.AppError(`Payment amount cannot exceed balance due of ₹${(invoice.balanceDuePaise / 100).toFixed(2)}`, 400);
        }
        // Generate unique sequential receipt number
        const receiptNumber = await (0, receiptNumber_service_1.generateReceiptNumber)(orgId);
        // Create payment ledger record
        const payment = await Payment_1.Payment.create({
            organization: orgId,
            property: invoice.property,
            tenant: invoice.tenant,
            invoice: invoice._id,
            receiptNumber,
            amountPaidPaise: paymentAmount,
            paymentMethod,
            transactionReference,
            notes,
            recordedBy: userId ? new mongoose_1.default.Types.ObjectId(userId) : undefined,
            paymentDate: new Date(),
        });
        // Update invoice balance and status
        invoice.amountPaidPaise += paymentAmount;
        invoice.balanceDuePaise = Math.max(0, invoice.totalAmountPaise - invoice.amountPaidPaise);
        invoice.status = invoice.balanceDuePaise === 0 ? 'paid' : 'partially_paid';
        if (invoice.balanceDuePaise === 0) {
            invoice.paidAt = new Date();
        }
        await invoice.save();
        res.status(200).json({
            success: true,
            message: `Payment of ₹${(paymentAmount / 100).toFixed(2)} recorded with receipt ${receiptNumber}`,
            data: {
                invoice,
                payment,
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.markInvoicePaid = markInvoicePaid;
/**
 * GET /api/payments
 * Query recorded payments / receipts scoped by organization
 */
const getPayments = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        const filter = { organization: orgId };
        if (req.query.propertyId) {
            if (!mongoose_1.default.Types.ObjectId.isValid(req.query.propertyId)) {
                throw new errorHandler_1.AppError('Invalid property ID format', 400);
            }
            filter.property = req.query.propertyId;
        }
        if (req.query.tenantId) {
            if (!mongoose_1.default.Types.ObjectId.isValid(req.query.tenantId)) {
                throw new errorHandler_1.AppError('Invalid tenant ID format', 400);
            }
            filter.tenant = req.query.tenantId;
        }
        if (req.query.invoiceId) {
            if (!mongoose_1.default.Types.ObjectId.isValid(req.query.invoiceId)) {
                throw new errorHandler_1.AppError('Invalid invoice ID format', 400);
            }
            filter.invoice = req.query.invoiceId;
        }
        const payments = await Payment_1.Payment.find(filter)
            .populate('tenant', 'fullName phone currentBed')
            .populate('property', 'name upiVpa')
            .populate('invoice', 'invoiceNumber month year')
            .sort({ paymentDate: -1 });
        res.status(200).json({
            success: true,
            count: payments.length,
            data: payments,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getPayments = getPayments;
