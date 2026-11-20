import mongoose, { Document, Schema, Types } from 'mongoose';

export type MeterBillingMode = 'next_rent_invoice' | 'separate_invoice';
export type MeterSplitStatus = 'pending_billing' | 'invoiced' | 'settled_at_checkout' | 'cancelled';

export interface ITenantMeterSplit {
  tenant: Types.ObjectId;
  daysOccupied: number;
  sharePaise: number;
  status: MeterSplitStatus;
  invoice?: Types.ObjectId;
  billingPeriod?: {
    from: Date;
    to: Date;
  };
}

export interface IMeterReading extends Document {
  organization: Types.ObjectId;
  property: Types.ObjectId;
  room: Types.ObjectId;
  meterIdentifier?: string;
  previousReading: number;
  currentReading: number;
  unitsConsumed: number;
  ratePaisePerUnit: number;
  totalAmountPaise: number;
  readingDate: Date;
  previousReadingDate?: Date;
  currentReadingDate?: Date;
  billingMode: MeterBillingMode;
  photoUrl?: string;
  splitMethod: 'equal' | 'by_days_occupied';
  tenantSplits: ITenantMeterSplit[];
  recordedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MeterReadingSchema = new Schema<IMeterReading>(
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
    room: {
      type: Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
      index: true,
    },
    meterIdentifier: {
      type: String,
      trim: true,
    },
    previousReading: {
      type: Number,
      required: true,
      min: 0,
    },
    currentReading: {
      type: Number,
      required: true,
      min: 0,
    },
    unitsConsumed: {
      type: Number,
      required: true,
      min: 0,
    },
    ratePaisePerUnit: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    readingDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    previousReadingDate: {
      type: Date,
    },
    currentReadingDate: {
      type: Date,
      default: Date.now,
    },
    billingMode: {
      type: String,
      enum: ['next_rent_invoice', 'separate_invoice'],
      default: 'next_rent_invoice',
      required: true,
    },
    photoUrl: {
      type: String,
      trim: true,
    },
    splitMethod: {
      type: String,
      enum: ['equal', 'by_days_occupied'],
      default: 'equal',
      required: true,
    },
    tenantSplits: [
      {
        tenant: {
          type: Schema.Types.ObjectId,
          ref: 'Tenant',
          required: true,
        },
        daysOccupied: {
          type: Number,
          required: true,
          default: 30,
        },
        sharePaise: {
          type: Number,
          required: true,
          min: 0,
        },
        status: {
          type: String,
          enum: ['pending_billing', 'invoiced', 'settled_at_checkout', 'cancelled'],
          default: 'pending_billing',
          required: true,
        },
        invoice: {
          type: Schema.Types.ObjectId,
          ref: 'Invoice',
        },
        billingPeriod: {
          from: { type: Date },
          to: { type: Date },
        },
      },
    ],
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  },
);

MeterReadingSchema.index({ organization: 1, room: 1, readingDate: -1 });

export const MeterReading = mongoose.model<IMeterReading>('MeterReading', MeterReadingSchema);
