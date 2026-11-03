import { z } from 'zod';
import mongoose from 'mongoose';

export const expenseCategoryEnum = z.enum([
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

export const createExpenseSchema = z.object({
  propertyId: z
    .string()
    .refine(val => mongoose.Types.ObjectId.isValid(val), {
      message: 'Invalid property ID format',
    })
    .optional(),
  category: expenseCategoryEnum,
  amountPaise: z.number().int().positive('Amount must be a positive integer in paise'),
  description: z.string().trim().min(2, 'Description must be at least 2 characters'),
  date: z.string().or(z.date()).optional(),
  receiptUrl: z.string().trim().optional(),
  paymentMethod: z.enum(['cash', 'upi', 'bank_transfer']).default('cash'),
  paidTo: z.string().trim().optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
