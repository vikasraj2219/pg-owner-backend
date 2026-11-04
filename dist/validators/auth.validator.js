"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginSchema = exports.registerOwnerSchema = void 0;
const zod_1 = require("zod");
exports.registerOwnerSchema = zod_1.z.object({
    ownerName: zod_1.z
        .string({ required_error: 'Owner name is required' })
        .trim()
        .min(2, 'Owner name must be at least 2 characters')
        .max(100, 'Owner name cannot exceed 100 characters'),
    orgName: zod_1.z
        .string({ required_error: 'Organization / PG name is required' })
        .trim()
        .min(2, 'Organization name must be at least 2 characters')
        .max(100, 'Organization name cannot exceed 100 characters'),
    phone: zod_1.z
        .string({ required_error: 'Phone number is required' })
        .trim()
        .min(10, 'Phone number must be at least 10 digits')
        .max(15, 'Phone number cannot exceed 15 digits')
        .regex(/^[0-9+]+$/, 'Phone number must contain only numbers and optional leading +'),
    email: zod_1.z
        .string({ required_error: 'Email is required' })
        .trim()
        .toLowerCase()
        .email('Invalid email address format'),
    password: zod_1.z
        .string({ required_error: 'Password is required' })
        .min(6, 'Password must be at least 6 characters long'),
});
exports.loginSchema = zod_1.z.object({
    identifier: zod_1.z
        .string({ required_error: 'Email or phone number is required' })
        .trim()
        .min(1, 'Email or phone number cannot be empty'),
    password: zod_1.z.string({ required_error: 'Password is required' }).min(1, 'Password cannot be empty'),
});
