import mongoose, { Document, Schema, Types } from 'mongoose';

export type ExpenseCategory =
  | 'maintenance'
  | 'electricity'
  | 'water'
  | 'wifi'
  | 'groceries_food'
  | 'staff_salary'
  | 'rent_lease'
  | 'cleaning'
  | 'other';

export interface IExpense extends Document {
  organization: Types.ObjectId;
  property?: Types.ObjectId;
  category: ExpenseCategory;
  amountPaise: number;
  description: string;
  date: Date;
  receiptUrl?: string;
  paymentMethod: 'cash' | 'upi' | 'bank_transfer';
  paidTo?: string;
  recordedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    property: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      index: true,
    },
    category: {
      type: String,
      enum: [
        'maintenance',
        'electricity',
        'water',
        'wifi',
        'groceries_food',
        'staff_salary',
        'rent_lease',
        'cleaning',
        'other',
      ],
      required: true,
      index: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    receiptUrl: {
      type: String,
      trim: true,
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'bank_transfer'],
      default: 'cash',
      required: true,
    },
    paidTo: {
      type: String,
      trim: true,
    },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  },
);

ExpenseSchema.index({ organization: 1, date: -1 });
ExpenseSchema.index({ organization: 1, property: 1, date: -1 });

export const Expense = mongoose.model<IExpense>('Expense', ExpenseSchema);
