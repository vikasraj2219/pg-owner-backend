"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quickCheckinSchema = void 0;
const zod_1 = require("zod");
exports.quickCheckinSchema = zod_1.z.object({
    propertyId: zod_1.z
        .string({ required_error: 'Property ID is required' })
        .min(1, 'Property ID cannot be empty'),
    bedId: zod_1.z.string({ required_error: 'Bed ID is required' }).min(1, 'Bed ID cannot be empty'),
    fullName: zod_1.z
        .string({ required_error: 'Tenant full name is required' })
        .trim()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name cannot exceed 100 characters'),
    phone: zod_1.z
        .string({ required_error: 'Tenant phone number is required' })
        .trim()
        .min(10, 'Phone number must be at least 10 digits')
        .max(15, 'Phone number cannot exceed 15 digits')
        .regex(/^[0-9+]+$/, 'Phone number must contain only digits and optional leading +'),
    emergencyPhone: zod_1.z
        .string()
        .trim()
        .min(10, 'Emergency phone must be at least 10 digits')
        .max(15, 'Emergency phone cannot exceed 15 digits')
        .regex(/^[0-9+]+$/, 'Emergency phone must contain only digits and optional leading +')
        .optional()
        .or(zod_1.z.literal('')),
    joinDate: zod_1.z
        .string()
        .optional()
        .default(() => new Date().toISOString())
        .refine(val => !isNaN(Date.parse(val)), {
        message: 'joinDate must be a valid ISO date string',
    }),
    monthlyRentPaise: zod_1.z
        .number({ required_error: 'Monthly rent in paise is required' })
        .int('Rent must be an integer (paise)')
        .min(0, 'Rent cannot be negative'),
    depositPaise: zod_1.z
        .number({ required_error: 'Security deposit in paise is required' })
        .int('Deposit must be an integer (paise)')
        .min(0, 'Deposit cannot be negative'),
    depositPaidPaise: zod_1.z
        .number()
        .int('Deposit paid must be an integer (paise)')
        .min(0, 'Deposit paid cannot be negative')
        .default(0),
    depositPaymentMethod: zod_1.z.enum(['cash', 'upi', 'bank_transfer']).default('cash'),
    depositTransactionRef: zod_1.z.string().trim().max(100).optional(),
    kycDocType: zod_1.z.enum(['aadhaar', 'pan', 'passport', 'voter_id']).optional(),
    kycMaskedNumber: zod_1.z.string().trim().max(50).optional(),
    kycDocUrl: zod_1.z.string().trim().url('kycDocUrl must be a valid URL').optional().or(zod_1.z.literal('')),
    kycConsent: zod_1.z.boolean({ required_error: 'KYC consent is required' }).refine(val => val === true, {
        message: 'KYC consent is mandatory under the DPDP Act 2023',
    }),
});
