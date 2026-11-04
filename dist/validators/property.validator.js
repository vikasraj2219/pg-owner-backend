"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBedStatusSchema = exports.updateRoomSchema = exports.createRoomSchema = exports.updatePropertySchema = exports.createPropertySchema = void 0;
const zod_1 = require("zod");
exports.createPropertySchema = zod_1.z.object({
    name: zod_1.z
        .string({ required_error: 'Property name is required' })
        .trim()
        .min(1, 'Property name cannot be empty')
        .max(100, 'Property name cannot exceed 100 characters'),
    type: zod_1.z.enum(['boys', 'girls', 'coliving'], {
        required_error: 'Property type must be boys, girls, or coliving',
    }),
    address: zod_1.z.string().trim().max(250, 'Address cannot exceed 250 characters').optional(),
    upiVpa: zod_1.z
        .string({ required_error: 'UPI VPA is required' })
        .trim()
        .min(3, 'UPI VPA is too short')
        .regex(/^[\w.-]+@[\w.-]+$/, 'Please provide a valid UPI ID (e.g. name@okaxis)'),
    electricityRatePaisePerUnit: zod_1.z
        .number({ required_error: 'Electricity rate per unit is required' })
        .int('Electricity rate must be specified in integer paise')
        .nonnegative('Electricity rate cannot be negative')
        .default(1200),
});
exports.updatePropertySchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(100).optional(),
    type: zod_1.z.enum(['boys', 'girls', 'coliving']).optional(),
    address: zod_1.z.string().trim().max(250).optional(),
    upiVpa: zod_1.z
        .string()
        .trim()
        .regex(/^[\w.-]+@[\w.-]+$/, 'Please provide a valid UPI ID')
        .optional(),
    electricityRatePaisePerUnit: zod_1.z
        .number()
        .int('Electricity rate must be specified in integer paise')
        .nonnegative()
        .optional(),
    isActive: zod_1.z.boolean().optional(),
});
exports.createRoomSchema = zod_1.z.object({
    floorNumber: zod_1.z
        .number({ required_error: 'Floor number is required' })
        .int('Floor number must be an integer'),
    roomNumber: zod_1.z
        .string({ required_error: 'Room number is required' })
        .trim()
        .min(1, 'Room number cannot be empty')
        .max(20, 'Room number cannot exceed 20 characters'),
    sharingType: zod_1.z
        .number({ required_error: 'Sharing type (number of beds) is required' })
        .int('Sharing type must be a whole integer')
        .min(1, 'Sharing type must be at least 1')
        .max(20, 'Sharing type cannot exceed 20 beds'),
    baseRentPaisePerBed: zod_1.z
        .number({ required_error: 'Base rent per bed in paise is required' })
        .int('Base rent must be specified in integer paise')
        .nonnegative('Base rent cannot be negative'),
    tags: zod_1.z.array(zod_1.z.string().trim()).optional().default([]),
});
exports.updateRoomSchema = zod_1.z.object({
    baseRentPaisePerBed: zod_1.z
        .number()
        .int('Base rent must be specified in integer paise')
        .nonnegative()
        .optional(),
    tags: zod_1.z.array(zod_1.z.string().trim()).optional(),
});
exports.updateBedStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['available', 'occupied', 'notice_period', 'maintenance'], {
        required_error: 'Bed status is required',
    }),
    maintenanceNote: zod_1.z.string().trim().max(200).optional(),
    noticeEndDate: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.date()]).optional(),
});
