"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.markPaidSchema = exports.generateMonthlyInvoicesSchema = void 0;
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
