"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateInvoiceSchema = exports.createManualInvoiceSchema = exports.invoiceItemSchema = exports.markPaidSchema = exports.generateMonthlyInvoicesSchema = void 0;
const zod_1 = require("zod");
const mongoose_1 = __importDefault(require("mongoose"));
exports.generateMonthlyInvoicesSchema = zod_1.z.object({
    month: zod_1.z.coerce.number().int().min(1).max(12).optional(),
    year: zod_1.z.coerce.number().int().min(2020).max(2100).optional(),
    propertyId: zod_1.z
        .string()
        .refine(val => mongoose_1.default.Types.ObjectId.isValid(val), {
        message: 'Invalid property ID format',
    })
        .optional(),
});
exports.markPaidSchema = zod_1.z.object({
    amountPaise: zod_1.z.coerce.number().int().positive('Payment amount must be greater than 0').optional(),
    paymentMethod: zod_1.z.enum(['cash', 'upi', 'bank_transfer']).default('upi'),
    transactionReference: zod_1.z.string().trim().max(100).optional().default(''),
    notes: zod_1.z.string().trim().max(500).optional().default(''),
});
exports.invoiceItemSchema = zod_1.z.object({
    description: zod_1.z.string().trim().min(1, 'Item description is required').max(200),
    amountPaise: zod_1.z.coerce.number().int().min(0, 'Amount cannot be negative'),
    category: zod_1.z.enum(['rent', 'electricity', 'mess', 'late_fee', 'damage']).default('rent'),
});
exports.createManualInvoiceSchema = zod_1.z.object({
    tenantId: zod_1.z.string().refine(val => mongoose_1.default.Types.ObjectId.isValid(val), {
        message: 'Invalid tenant ID format',
    }),
    propertyId: zod_1.z
        .string()
        .refine(val => mongoose_1.default.Types.ObjectId.isValid(val), {
        message: 'Invalid property ID format',
    })
        .optional(),
    dueDate: zod_1.z.string().or(zod_1.z.date()),
    month: zod_1.z.coerce.number().int().min(1).max(12).optional(),
    year: zod_1.z.coerce.number().int().min(2020).max(2100).optional(),
    items: zod_1.z.array(exports.invoiceItemSchema).min(1, 'At least one line item is required'),
});
exports.updateInvoiceSchema = zod_1.z.object({
    dueDate: zod_1.z.string().or(zod_1.z.date()).optional(),
    items: zod_1.z.array(exports.invoiceItemSchema).min(1, 'At least one line item is required').optional(),
    status: zod_1.z.enum(['unpaid', 'partially_paid', 'paid', 'canceled']).optional(),
});
