"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMeterReadingSchema = void 0;
const zod_1 = require("zod");
const mongoose_1 = __importDefault(require("mongoose"));
exports.createMeterReadingSchema = zod_1.z
    .object({
    propertyId: zod_1.z.string().refine(val => mongoose_1.default.Types.ObjectId.isValid(val), {
        message: 'Invalid property ID format',
    }),
    roomId: zod_1.z.string().refine(val => mongoose_1.default.Types.ObjectId.isValid(val), {
        message: 'Invalid room ID format',
    }),
    meterIdentifier: zod_1.z.string().trim().optional(),
    previousReading: zod_1.z.number().nonnegative(),
    currentReading: zod_1.z.number().nonnegative(),
    ratePaisePerUnit: zod_1.z.number().int().nonnegative().optional(),
    readingDate: zod_1.z.string().or(zod_1.z.date()).optional(),
    photoUrl: zod_1.z.string().trim().optional(),
    splitMethod: zod_1.z.enum(['equal', 'by_days_occupied']).default('equal'),
})
    .refine(data => data.currentReading >= data.previousReading, {
    message: 'Current reading cannot be lower than previous reading',
    path: ['currentReading'],
});
