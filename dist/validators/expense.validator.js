"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExpenseSchema = exports.expenseCategoryEnum = void 0;
const zod_1 = require("zod");
const mongoose_1 = __importDefault(require("mongoose"));
exports.expenseCategoryEnum = zod_1.z.enum([
    'maintenance',
    'electricity',
    'water',
    'wifi',
    'groceries_food',
    'staff_salary',
    'rent_lease',
    'cleaning',
    'other',
]);
exports.createExpenseSchema = zod_1.z.object({
    propertyId: zod_1.z
        .string()
        .refine(val => mongoose_1.default.Types.ObjectId.isValid(val), {
        message: 'Invalid property ID format',
    })
        .optional(),
    category: exports.expenseCategoryEnum,
    amountPaise: zod_1.z.number().int().positive('Amount must be a positive integer in paise'),
    description: zod_1.z.string().trim().min(2, 'Description must be at least 2 characters'),
    date: zod_1.z.string().or(zod_1.z.date()).optional(),
    receiptUrl: zod_1.z.string().trim().optional(),
    paymentMethod: zod_1.z.enum(['cash', 'upi', 'bank_transfer']).default('cash'),
    paidTo: zod_1.z.string().trim().optional(),
});
