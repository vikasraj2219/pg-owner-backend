import mongoose, { Document, Schema, Model } from 'mongoose';

export type TenantStatus = 'active' | 'notice_period' | 'checked_out';
export type KycDocType = 'aadhaar' | 'pan' | 'passport' | 'voter_id';

export interface ITenant extends Document {
  organization: mongoose.Types.ObjectId;
  property: mongoose.Types.ObjectId;
  currentBed?: mongoose.Types.ObjectId;
  fullName: string;
  phone: string;
  emergencyPhone?: string;
  monthlyRentPaise: number; // Integer paise
  depositPaise: number; // Integer paise
  depositPaidPaise: number; // Integer paise
  kycDocType?: KycDocType;
  kycMaskedNumber?: string;
  kycDocUrl?: string;
  kycConsent: boolean;
  status: TenantStatus;
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

