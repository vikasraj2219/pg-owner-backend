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

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, 'Item description is required').max(200),
  amountPaise: z.coerce.number().int().min(0, 'Amount cannot be negative'),
  category: z.enum(['rent', 'electricity', 'mess', 'late_fee', 'damage']).default('rent'),
});

export const createManualInvoiceSchema = z.object({
  tenantId: z.string().refine(val => mongoose.Types.ObjectId.isValid(val), {
    message: 'Invalid tenant ID format',
  }),
  propertyId: z
    .string()
    .refine(val => mongoose.Types.ObjectId.isValid(val), {
      message: 'Invalid property ID format',
    })
    .optional(),
  dueDate: z.string().or(z.date()),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  items: z.array(invoiceItemSchema).min(1, 'At least one line item is required'),
});

export const updateInvoiceSchema = z.object({
  dueDate: z.string().or(z.date()).optional(),
  items: z.array(invoiceItemSchema).min(1, 'At least one line item is required').optional(),
  status: z.enum(['unpaid', 'partially_paid', 'paid', 'canceled']).optional(),
});

export type GenerateMonthlyInvoicesInput = z.infer<typeof generateMonthlyInvoicesSchema>;
export type MarkPaidInput = z.infer<typeof markPaidSchema>;
export type CreateManualInvoiceInput = z.infer<typeof createManualInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
