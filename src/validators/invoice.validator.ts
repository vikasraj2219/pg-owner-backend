import { z } from 'zod';
import mongoose from 'mongoose';

export const generateMonthlyInvoicesSchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  propertyId: z
    .string()
    .refine(val => mongoose.Types.ObjectId.isValid(val), {
      message: 'Invalid property ID format',
    })
    .optional(),
});

export const markPaidSchema = z.object({
  amountPaise: z.coerce.number().int().positive('Payment amount must be greater than 0').optional(),
  paymentMethod: z.enum(['cash', 'upi', 'bank_transfer']).default('upi'),
  transactionReference: z.string().trim().max(100).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

export type GenerateMonthlyInvoicesInput = z.infer<typeof generateMonthlyInvoicesSchema>;
export type MarkPaidInput = z.infer<typeof markPaidSchema>;
