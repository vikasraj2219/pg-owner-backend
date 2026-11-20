"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteInvoice = exports.updateInvoice = exports.createManualInvoice = exports.getPayments = exports.markInvoicePaid = exports.generateMonthlyInvoices = exports.getInvoiceById = exports.getInvoices = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Invoice_1 = require("../models/Invoice");
const Payment_1 = require("../models/Payment");
const Organization_1 = require("../models/Organization");
const Tenant_1 = require("../models/Tenant");
const BedAssignment_1 = require("../models/BedAssignment");
const MeterReading_1 = require("../models/MeterReading");
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
        const now = new Date();
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
        if (statusParam === 'overdue' || statusParam === 'unpaid') {
            filter.status = { $in: ['unpaid', 'partially_paid'] };
        }
        else if (statusParam === 'paid') {
            filter.status = 'paid';
        }
        const invoices = await Invoice_1.Invoice.find(filter)
            .populate('tenant', 'fullName phone currentBed status photoUrl gender')
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
            .populate('tenant', 'fullName phone currentBed status photoUrl gender')
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
                // Check for unbilled Mode A electricity allocations for this tenant
                const pendingMeterReadings = await MeterReading_1.MeterReading.find({
                    organization: targetId,
                    'tenantSplits.tenant': tenantId,
                    'tenantSplits.status': 'pending_billing',
                });
                const invoiceItems = [
                    {
                        description: cycle.description,
                        amountPaise: rentPaise,
                        category: 'rent',
                    },
                ];
                let totalInvoicePaise = rentPaise;
                const splitsToUpdate = [];
                for (const mr of pendingMeterReadings) {
                    for (const sp of mr.tenantSplits) {
                        if (sp.tenant.toString() === tenantId.toString() &&
                            sp.status === 'pending_billing' &&
                            sp.sharePaise > 0) {
                            const windowStart = mr.previousReadingDate || mr.readingDate;
                            const windowEnd = mr.currentReadingDate || mr.readingDate;
                            const periodText = `${new Date(windowStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${new Date(windowEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
                            const itemTag = `[MTR:${mr._id.toString()}]`;
                            const ebDesc = `Electricity: ${mr.meterIdentifier || 'Sub-meter'} (${mr.unitsConsumed}u @ ₹${(mr.ratePaisePerUnit / 100).toFixed(1)}/u: ${periodText}) ${itemTag}`;
                            invoiceItems.push({
                                description: ebDesc,
                                amountPaise: sp.sharePaise,
                                category: 'electricity',
                            });
                            totalInvoicePaise += sp.sharePaise;
                            splitsToUpdate.push({ reading: mr, split: sp });
                        }
                    }
                }
                try {
                    const newInvoice = await Invoice_1.Invoice.create({
                        organization: targetId,
                        property: assignment.property,
                        tenant: tenantId,
                        invoiceNumber,
                        invoiceType: 'rent',
                        month: targetMonth,
                        year: targetYear,
                        dueDate: cycle.periodStart, // Due on tenant's join date anniversary
                        periodStart: cycle.periodStart,
                        periodEnd: cycle.periodEnd,
                        items: invoiceItems,
                        totalAmountPaise: totalInvoicePaise,
                        amountPaidPaise: 0,
                        balanceDuePaise: totalInvoicePaise,
                        status: 'unpaid',
                    });
                    // Mark pending splits as invoiced and link to the new invoice
                    for (const item of splitsToUpdate) {
                        item.split.status = 'invoiced';
                        item.split.invoice = newInvoice._id;
                        await item.reading.save();
                    }
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
/**
 * POST /api/invoices
 * Create a manual invoice for a tenant
 */
const createManualInvoice = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        const parsed = invoice_validator_1.createManualInvoiceSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new errorHandler_1.AppError(parsed.error.errors[0]?.message || 'Invalid invoice data', 400);
        }
        const { tenantId, propertyId, dueDate, month, year, items } = parsed.data;
        const tenant = await Tenant_1.Tenant.findOne({ _id: tenantId, organization: orgId });
        if (!tenant) {
            throw new errorHandler_1.AppError('Tenant not found in your organization', 404);
        }
        const propId = propertyId || tenant.property;
        if (!propId) {
            throw new errorHandler_1.AppError('Property ID is required or tenant must be assigned to a property', 400);
        }
        const dueDateObj = new Date(dueDate);
        if (isNaN(dueDateObj.getTime())) {
            throw new errorHandler_1.AppError('Invalid due date', 400);
        }
        const invMonth = month ?? dueDateObj.getMonth() + 1;
        const invYear = year ?? dueDateObj.getFullYear();
        // Check if an invoice already exists for this tenant in this month/year
        const existing = await Invoice_1.Invoice.findOne({
            organization: orgId,
            tenant: tenantId,
            month: invMonth,
            year: invYear,
        });
        if (existing) {
            throw new errorHandler_1.AppError(`An invoice for ${MONTH_NAMES[invMonth - 1]} ${invYear} already exists for this tenant (${existing.invoiceNumber}). You can edit the existing invoice to add or adjust items.`, 400);
        }
        const totalAmountPaise = items.reduce((sum, item) => sum + item.amountPaise, 0);
        if (totalAmountPaise <= 0) {
            throw new errorHandler_1.AppError('Total invoice amount must be greater than 0', 400);
        }
        const invoiceNumber = await (0, invoiceNumber_service_1.generateInvoiceNumber)(orgId.toString(), invYear, invMonth);
        const invoice = await Invoice_1.Invoice.create({
            organization: orgId,
            property: propId,
            tenant: tenantId,
            invoiceNumber,
            month: invMonth,
            year: invYear,
            dueDate: dueDateObj,
            items,
            totalAmountPaise,
            amountPaidPaise: 0,
            balanceDuePaise: totalAmountPaise,
            status: 'unpaid',
        });
        const populated = await Invoice_1.Invoice.findById(invoice._id)
            .populate('tenant', 'fullName phone currentBed status')
            .populate('property', 'name type address upiVpa');
        res.status(201).json({
            success: true,
            message: `Invoice ${invoiceNumber} created successfully`,
            data: populated,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.createManualInvoice = createManualInvoice;
/**
 * PUT /api/invoices/:id
 * Update an existing invoice (dueDate, items, status)
 */
const updateInvoice = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid invoice ID format', 400);
        }
        const parsed = invoice_validator_1.updateInvoiceSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new errorHandler_1.AppError(parsed.error.errors[0]?.message || 'Invalid update data', 400);
        }
        const invoice = await Invoice_1.Invoice.findOne({ _id: id, organization: orgId });
        if (!invoice) {
            throw new errorHandler_1.AppError('Invoice not found or does not belong to your organization', 404);
        }
        const { dueDate, items, status } = parsed.data;
        if (dueDate) {
            const d = new Date(dueDate);
            if (isNaN(d.getTime())) {
                throw new errorHandler_1.AppError('Invalid due date', 400);
            }
            invoice.dueDate = d;
        }
        if (items && items.length > 0) {
            const newTotalPaise = items.reduce((sum, it) => sum + it.amountPaise, 0);
            if (newTotalPaise < invoice.amountPaidPaise) {
                throw new errorHandler_1.AppError(`Total amount (₹${(newTotalPaise / 100).toFixed(2)}) cannot be less than already paid amount (₹${(invoice.amountPaidPaise / 100).toFixed(2)})`, 400);
            }
            invoice.items = items;
            invoice.totalAmountPaise = newTotalPaise;
            invoice.balanceDuePaise = Math.max(0, newTotalPaise - invoice.amountPaidPaise);
            if (invoice.balanceDuePaise === 0) {
                invoice.status = 'paid';
                if (!invoice.paidAt)
                    invoice.paidAt = new Date();
            }
            else if (invoice.amountPaidPaise > 0) {
                invoice.status = 'partially_paid';
            }
            else {
                invoice.status = 'unpaid';
            }
        }
        if (status) {
            if (status === 'canceled' && invoice.amountPaidPaise > 0) {
                throw new errorHandler_1.AppError('Cannot cancel an invoice with recorded payments', 400);
            }
            invoice.status = status;
        }
        await invoice.save();
        const updated = await Invoice_1.Invoice.findById(invoice._id)
            .populate('tenant', 'fullName phone currentBed status')
            .populate('property', 'name type address upiVpa');
        res.status(200).json({
            success: true,
            message: 'Invoice updated successfully',
            data: updated,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.updateInvoice = updateInvoice;
/**
 * DELETE /api/invoices/:id
 * Delete an existing invoice (if no payments made against it)
 */
const deleteInvoice = async (req, res, next) => {
    try {
        const { id } = req.params;
        const orgId = req.orgId;
        if (!orgId) {
            throw new errorHandler_1.AppError('Organization context is required', 403);
        }
        if (!id || !mongoose_1.default.Types.ObjectId.isValid(id)) {
            throw new errorHandler_1.AppError('Invalid invoice ID format', 400);
        }
        const invoice = await Invoice_1.Invoice.findOne({ _id: id, organization: orgId });
        if (!invoice) {
            throw new errorHandler_1.AppError('Invoice not found or does not belong to your organization', 404);
        }
        if (invoice.amountPaidPaise > 0) {
            throw new errorHandler_1.AppError('Cannot delete an invoice with recorded payments. Please refund or remove the payments first, or mark the invoice as canceled.', 400);
        }
        // Also delete any dangling payments or related records if any
        await Payment_1.Payment.deleteMany({ invoice: invoice._id, organization: orgId });
        await Invoice_1.Invoice.deleteOne({ _id: invoice._id, organization: orgId });
        res.status(200).json({
            success: true,
            message: `Invoice ${invoice.invoiceNumber} deleted successfully`,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.deleteInvoice = deleteInvoice;
