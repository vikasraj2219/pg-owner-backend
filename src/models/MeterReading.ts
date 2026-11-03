import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ITenantMeterSplit {
  tenant: Types.ObjectId;
  daysOccupied: number;
  sharePaise: number;
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
