import { z } from 'zod';
import mongoose from 'mongoose';

export const createTeamMemberSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian phone number'),
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  role: z.enum(['manager', 'staff'], {
    errorMap: () => ({ message: "Role must be either 'manager' or 'staff'" }),
  }),
  assignedProperties: z
    .array(
      z.string().refine(val => mongoose.Types.ObjectId.isValid(val), {
        message: 'Invalid property ID format',
      }),
    )
    .optional(),
});

export const updateTeamMemberSchema = z.object({
  name: z.string().trim().min(2).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/)
    .optional(),
  role: z.enum(['manager', 'staff']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  assignedProperties: z
    .array(
      z.string().refine(val => mongoose.Types.ObjectId.isValid(val), {
        message: 'Invalid property ID format',
      }),
    )
    .optional(),
});

export type CreateTeamMemberInput = z.infer<typeof createTeamMemberSchema>;
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>;

