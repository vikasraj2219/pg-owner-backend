import mongoose, { Document, Schema, Model } from 'mongoose';

export type TenantStatus = 'active' | 'notice_period' | 'checked_out';
export type KycDocType = 'aadhaar' | 'pan' | 'passport' | 'voter_id';

export interface IBedTransferHistoryItem {
  fromBed?: mongoose.Types.ObjectId;
  toBed?: mongoose.Types.ObjectId;
  fromRoom?: mongoose.Types.ObjectId;
  toRoom?: mongoose.Types.ObjectId;
  fromProperty?: mongoose.Types.ObjectId;
  toProperty?: mongoose.Types.ObjectId;
  previousRentPaise: number;
  newRentPaise: number;
  effectiveDate: Date;
  transferDate: Date;
  effectiveType: 'immediate' | 'next_month' | 'custom';
  proratedAdjustmentPaise?: number;
  notes?: string;
  status: 'completed' | 'scheduled' | 'cancelled';
}

export interface IScheduledTransfer {
  targetBed: mongoose.Types.ObjectId;
  targetRoom: mongoose.Types.ObjectId;
  targetProperty: mongoose.Types.ObjectId;
  newMonthlyRentPaise: number;
  effectiveDate: Date;
  effectiveType: 'immediate' | 'next_month' | 'custom';
  proratedAdjustmentPaise?: number;
  generateAdjustmentInvoice?: boolean;
  notes?: string;
  scheduledAt: Date;
}

export interface ITenant extends Document {
  organization: mongoose.Types.ObjectId;
  property: mongoose.Types.ObjectId;
  currentBed?: mongoose.Types.ObjectId;
  fullName: string;
  phone: string;
  emergencyPhone?: string;
  email?: string;
  monthlyRentPaise: number; // Integer paise
  depositPaise: number; // Integer paise
  depositPaidPaise: number; // Integer paise
  joinDate?: Date;
  billingCycleDay?: number; // 1-31 (Day of month rent is due)
  kycDocType?: KycDocType;
  kycMaskedNumber?: string;
  kycDocUrl?: string;
  kycConsent: boolean;
  status: TenantStatus;
  scheduledTransfer?: IScheduledTransfer;
  transferHistory?: IBedTransferHistoryItem[];
  isDeleted?: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema<ITenant>(
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
    currentBed: {
      type: Schema.Types.ObjectId,
      ref: 'Bed',
      default: null,
    },
    fullName: {
      type: String,
      required: [true, 'Tenant full name is required'],
      trim: true,
      maxlength: 100,
    },
    phone: {
      type: String,
      required: [true, 'Tenant phone number is required'],
      trim: true,
    },
    emergencyPhone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    monthlyRentPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    depositPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    depositPaidPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    joinDate: {
      type: Date,
      default: Date.now,
    },
    billingCycleDay: {
      type: Number,
      min: 1,
      max: 31,
    },
    kycDocType: {
      type: String,
      enum: ['aadhaar', 'pan', 'passport', 'voter_id'],
    },
    kycMaskedNumber: {
      type: String,
      trim: true,
    },
    kycDocUrl: {
      type: String,
      trim: true,
    },
    kycConsent: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['active', 'notice_period', 'checked_out'],
      default: 'active',
      index: true,
    },
    scheduledTransfer: {
      type: {
        targetBed: { type: Schema.Types.ObjectId, ref: 'Bed' },
        targetRoom: { type: Schema.Types.ObjectId, ref: 'Room' },
        targetProperty: { type: Schema.Types.ObjectId, ref: 'Property' },
        newMonthlyRentPaise: Number,
        effectiveDate: Date,
        effectiveType: { type: String, enum: ['immediate', 'next_month', 'custom'] },
        proratedAdjustmentPaise: Number,
        generateAdjustmentInvoice: Boolean,
        notes: String,
        scheduledAt: { type: Date, default: Date.now },
      },
      default: null,
    },
    transferHistory: [
      {
        fromBed: { type: Schema.Types.ObjectId, ref: 'Bed' },
        toBed: { type: Schema.Types.ObjectId, ref: 'Bed' },
        fromRoom: { type: Schema.Types.ObjectId, ref: 'Room' },
        toRoom: { type: Schema.Types.ObjectId, ref: 'Room' },
        fromProperty: { type: Schema.Types.ObjectId, ref: 'Property' },
        toProperty: { type: Schema.Types.ObjectId, ref: 'Property' },
        previousRentPaise: Number,
        newRentPaise: Number,
        effectiveDate: Date,
        transferDate: { type: Date, default: Date.now },
        effectiveType: { type: String, enum: ['immediate', 'next_month', 'custom'] },
        proratedAdjustmentPaise: Number,
        notes: String,
        status: {
          type: String,
          enum: ['completed', 'scheduled', 'cancelled'],
          default: 'completed',
        },
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
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

TenantSchema.index({ organization: 1, phone: 1 });

export const Tenant: Model<ITenant> =
  mongoose.models.Tenant || mongoose.model<ITenant>('Tenant', TenantSchema);
