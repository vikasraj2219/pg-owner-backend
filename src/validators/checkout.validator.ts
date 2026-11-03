import { z } from 'zod';
import mongoose from 'mongoose';

export const checkoutConfirmSchema = z.object({
  tenantId: z.string().refine(val => mongoose.Types.ObjectId.isValid(val), {
    message: 'Invalid tenant ID format',
  }),
  damageDeductionsPaise: z.number().int().nonnegative().default(0),
  electricityDeductionsPaise: z.number().int().nonnegative().default(0),
  otherDeductionsPaise: z.number().int().nonnegative().default(0),
  refundPaise: z.number().int().nonnegative().optional(),
  paymentMethod: z.enum(['cash', 'upi', 'bank_transfer']).default('cash'),
  transactionReference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type CheckoutConfirmInput = z.infer<typeof checkoutConfirmSchema>;
