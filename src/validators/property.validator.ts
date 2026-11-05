import { z } from 'zod';

export const createPropertySchema = z.object({
  name: z
    .string({ required_error: 'Property name is required' })
    .trim()
    .min(1, 'Property name cannot be empty')
    .max(100, 'Property name cannot exceed 100 characters'),
  type: z.enum(['boys', 'girls', 'coliving'], {
    required_error: 'Property type must be boys, girls, or coliving',
  }),
  address: z.string().trim().max(250, 'Address cannot exceed 250 characters').optional(),
  city: z.string().trim().max(100, 'City cannot exceed 100 characters').optional(),
  pincode: z.string().trim().max(20, 'Pincode cannot exceed 20 characters').optional(),
  upiVpa: z
    .string({ required_error: 'UPI VPA is required' })
    .trim()
    .min(3, 'UPI VPA is too short')
    .regex(/^[\w.-]+@[\w.-]+$/, 'Please provide a valid UPI ID (e.g. name@okaxis)'),
  electricityRatePaisePerUnit: z
    .number({ required_error: 'Electricity rate per unit is required' })
    .int('Electricity rate must be specified in integer paise')
    .nonnegative('Electricity rate cannot be negative')
    .default(1200),
});

export const updatePropertySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: z.enum(['boys', 'girls', 'coliving']).optional(),
  address: z.string().trim().max(250).optional(),
  city: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(20).optional(),
  upiVpa: z
    .string()
    .trim()
    .regex(/^[\w.-]+@[\w.-]+$/, 'Please provide a valid UPI ID')
    .optional(),
  electricityRatePaisePerUnit: z
    .number()
    .int('Electricity rate must be specified in integer paise')
    .nonnegative()
    .optional(),
  isActive: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

export const createRoomSchema = z.object({
  floorNumber: z
    .number({ required_error: 'Floor number is required' })
    .int('Floor number must be an integer'),
  floorLabel: z.string().trim().max(50, 'Floor label cannot exceed 50 characters').optional(),
  roomNumber: z
    .string({ required_error: 'Room number is required' })
    .trim()
    .min(1, 'Room number cannot be empty')
    .max(20, 'Room number cannot exceed 20 characters'),
  sharingType: z
    .number({ required_error: 'Sharing type (number of beds) is required' })
    .int('Sharing type must be a whole integer')
    .min(1, 'Sharing type must be at least 1')
    .max(20, 'Sharing type cannot exceed 20 beds'),
  baseRentPaisePerBed: z
    .number({ required_error: 'Base rent per bed in paise is required' })
    .int('Base rent must be specified in integer paise')
    .nonnegative('Base rent cannot be negative'),
  tags: z.array(z.string().trim()).optional().default([]),
});

export const updateRoomSchema = z.object({
  roomNumber: z
    .string()
    .trim()
    .min(1, 'Room number cannot be empty')
    .max(20, 'Room number cannot exceed 20 characters')
    .optional(),
  floorNumber: z.number().int('Floor number must be an integer').optional(),
  floorLabel: z.string().trim().max(50, 'Floor label cannot exceed 50 characters').optional(),
  sharingType: z
    .number()
    .int('Sharing type must be a whole integer')
    .min(1, 'Sharing type must be at least 1')
    .max(20, 'Sharing type cannot exceed 20 beds')
    .optional(),
  baseRentPaisePerBed: z
    .number()
    .int('Base rent must be specified in integer paise')
    .nonnegative()
    .optional(),
  tags: z.array(z.string().trim()).optional(),
});

export const createFloorSchema = z.object({
  floorNumber: z
    .number({ required_error: 'Floor number is required' })
    .int('Floor number must be an integer'),
  floorLabel: z.string().trim().max(50, 'Floor label cannot exceed 50 characters').optional(),
});

export const updateFloorSchema = z.object({
  floorNumber: z.number().int('Floor number must be an integer').optional(),
  floorLabel: z.string().trim().max(50, 'Floor label cannot exceed 50 characters').optional(),
});

export const addBedSchema = z.object({
  bedNumber: z.string().trim().min(1).max(20).optional(),
});

export const updateBedSchema = z.object({
  bedNumber: z.string().trim().min(1).max(20).optional(),
  status: z.enum(['available', 'occupied', 'notice_period', 'maintenance']).optional(),
  maintenanceNote: z.string().trim().max(200).optional(),
  noticeEndDate: z.union([z.string().datetime(), z.date()]).optional(),
});

export const updateBedStatusSchema = z.object({
  status: z.enum(['available', 'occupied', 'notice_period', 'maintenance'], {
    required_error: 'Bed status is required',
  }),
  maintenanceNote: z.string().trim().max(200).optional(),
  noticeEndDate: z.union([z.string().datetime(), z.date()]).optional(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
export type CreateFloorInput = z.infer<typeof createFloorSchema>;
export type UpdateFloorInput = z.infer<typeof updateFloorSchema>;
export type UpdateBedInput = z.infer<typeof updateBedSchema>;
export type UpdateBedStatusInput = z.infer<typeof updateBedStatusSchema>;
