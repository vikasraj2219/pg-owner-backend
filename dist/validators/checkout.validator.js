"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkoutConfirmSchema = void 0;
const zod_1 = require("zod");
const mongoose_1 = __importDefault(require("mongoose"));
exports.checkoutConfirmSchema = zod_1.z.object({
    tenantId: zod_1.z.string().refine(val => mongoose_1.default.Types.ObjectId.isValid(val), {
        message: 'Invalid tenant ID format',
    }),
    damageDeductionsPaise: zod_1.z.number().int().nonnegative().default(0),
    electricityDeductionsPaise: zod_1.z.number().int().nonnegative().default(0),
    otherDeductionsPaise: zod_1.z.number().int().nonnegative().default(0),
    refundPaise: zod_1.z.number().int().nonnegative().optional(),
    paymentMethod: zod_1.z.enum(['cash', 'upi', 'bank_transfer']).default('cash'),
    transactionReference: zod_1.z.string().trim().optional(),
    notes: zod_1.z.string().trim().optional(),
});
