"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTeamMemberSchema = exports.createTeamMemberSchema = void 0;
const zod_1 = require("zod");
const mongoose_1 = __importDefault(require("mongoose"));
exports.createTeamMemberSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2, 'Name must be at least 2 characters'),
    phone: zod_1.z
        .string()
        .trim()
        .regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian phone number'),
    email: zod_1.z.string().trim().email('Invalid email address').toLowerCase(),
    password: zod_1.z.string().min(6, 'Password must be at least 6 characters long'),
    role: zod_1.z.enum(['manager', 'staff'], {
        errorMap: () => ({ message: "Role must be either 'manager' or 'staff'" }),
    }),
    assignedProperties: zod_1.z
        .array(zod_1.z.string().refine(val => mongoose_1.default.Types.ObjectId.isValid(val), {
        message: 'Invalid property ID format',
    }))
        .optional(),
});
exports.updateTeamMemberSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).optional(),
    phone: zod_1.z
        .string()
        .trim()
        .regex(/^[6-9]\d{9}$/)
        .optional(),
    email: zod_1.z.string().trim().email('Invalid email address').toLowerCase().optional(),
    password: zod_1.z.string().min(6, 'Password must be at least 6 characters long').optional(),
    role: zod_1.z.enum(['manager', 'staff']).optional(),
    status: zod_1.z.enum(['active', 'inactive']).optional(),
    assignedProperties: zod_1.z
        .array(zod_1.z.string().refine(val => mongoose_1.default.Types.ObjectId.isValid(val), {
        message: 'Invalid property ID format',
    }))
        .optional(),
});
