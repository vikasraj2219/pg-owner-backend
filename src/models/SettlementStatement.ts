import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISettlementStatement extends Document {
  organization: Types.ObjectId;
  property: Types.ObjectId;
  tenant: Types.ObjectId;
  bed?: Types.ObjectId;
  room?: Types.ObjectId;
  settlementNumber: string;
  checkinDate?: Date;
  checkoutDate: Date;
  depositPaidPaise: number;
  unpaidDuesPaise: number;
  damageDeductionsPaise: number;
  electricityDeductionsPaise: number;
  otherDeductionsPaise: number;
  totalDeductionsPaise: number;
  netRefundPaise: number;
  paymentMethod: 'cash' | 'upi' | 'bank_transfer';
  transactionReference?: string;
  notes?: string;
  recordedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SettlementStatementSchema = new Schema<ISettlementStatement>(
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
      required: true,
      index: true,
    },
    tenant: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    bed: {
      type: Schema.Types.ObjectId,
      ref: 'Bed',
    },
    room: {
      type: Schema.Types.ObjectId,
      ref: 'Room',
    },
    settlementNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    checkinDate: {
      type: Date,
    },
    checkoutDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    depositPaidPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    unpaidDuesPaise: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    damageDeductionsPaise: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    electricityDeductionsPaise: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    otherDeductionsPaise: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    totalDeductionsPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    netRefundPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'bank_transfer'],
      default: 'cash',
      required: true,
    },
    transactionReference: {
      type: String,
      trim: true,
    },
    notes: {
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

SettlementStatementSchema.index({ organization: 1, property: 1, checkoutDate: -1 });

export const SettlementStatement = mongoose.model<ISettlementStatement>(
  'SettlementStatement',
  SettlementStatementSchema,
);
