import { z } from 'zod';
import mongoose from 'mongoose';

export const createMeterReadingSchema = z
  .object({
    propertyId: z.string().refine(val => mongoose.Types.ObjectId.isValid(val), {
      message: 'Invalid property ID format',
    }),
    roomId: z.string().refine(val => mongoose.Types.ObjectId.isValid(val), {
      message: 'Invalid room ID format',
    }),
    meterIdentifier: z.string().trim().optional(),
    previousReading: z.number().nonnegative(),
    currentReading: z.number().nonnegative(),
    ratePaisePerUnit: z.number().int().nonnegative().optional(),
    readingDate: z.string().or(z.date()).optional(),
    photoUrl: z.string().trim().optional(),
    splitMethod: z.enum(['equal', 'by_days_occupied']).default('equal'),
  })
  .refine(data => data.currentReading >= data.previousReading, {
    message: 'Current reading cannot be lower than previous reading',
    path: ['currentReading'],
  });

export const updateMeterReadingSchema = z.object({
  meterIdentifier: z.string().trim().optional(),
  previousReading: z.number().nonnegative().optional(),
  currentReading: z.number().nonnegative().optional(),
  ratePaisePerUnit: z.number().int().nonnegative().optional(),
  readingDate: z.string().or(z.date()).optional(),
  photoUrl: z.string().trim().optional(),
  splitMethod: z.enum(['equal', 'by_days_occupied']).optional(),
});

export type CreateMeterReadingInput = z.infer<typeof createMeterReadingSchema>;
export type UpdateMeterReadingInput = z.infer<typeof updateMeterReadingSchema>;
