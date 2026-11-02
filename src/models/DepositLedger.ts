import mongoose, { Document, Schema, Model } from 'mongoose';

export type DepositTransactionType = 'received' | 'refunded' | 'deducted';
export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer';

export interface IDepositLedger extends Document {
  organization: mongoose.Types.ObjectId;
  property: mongoose.Types.ObjectId;
  tenant: mongoose.Types.ObjectId;
  amountPaise: number; // Integer paise
  type: DepositTransactionType;
  paymentMethod: PaymentMethod;
  transactionRef?: string;
  notes?: string;
  recordedBy?: mongoose.Types.ObjectId;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DepositLedgerSchema = new Schema<IDepositLedger>(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization ID is required'],
      index: true,
    },
    property: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property ID is required'],
      index: true,
    },
    tenant: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'Tenant ID is required'],
      index: true,
    },
    amountPaise: {
      type: Number,
      required: [true, 'Deposit amount in paise is required'],
      min: [1, 'Deposit amount must be greater than 0'],
    },
    type: {
      type: String,
      enum: ['received', 'refunded', 'deducted'],
      required: [true, 'Transaction type is required'],
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'bank_transfer'],
      required: [true, 'Payment method is required'],
      default: 'cash',
    },
    transactionRef: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    date: {
      type: Date,
      required: [true, 'Transaction date is required'],
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete (ret as Record<string, unknown>).__v;
        return ret;
      },
    },
  },
);

DepositLedgerSchema.index({ organization: 1, tenant: 1, date: -1 });

export const DepositLedger: Model<IDepositLedger> =
  mongoose.models.DepositLedger ||
  mongoose.model<IDepositLedger>('DepositLedger', DepositLedgerSchema);
