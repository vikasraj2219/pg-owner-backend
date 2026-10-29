import mongoose, { Document, Schema } from 'mongoose';
import { Paise } from '../types';

export interface IOrganizationSettings {
  rentDueDay: number; // 1-28 (e.g. 1 or 5)
  gracePeriodDays: number; // e.g. 5 days
  defaultLateFeePaise: Paise; // 10000 = ₹100
}

export interface IOrganization extends Document {
  name: string;
  ownerName: string;
  phone: string;
  email: string;
  settings: IOrganizationSettings;
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: {
      type: String,
      required: [true, 'Organization / PG name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    ownerName: {
      type: String,
      required: [true, 'Owner name is required'],
      trim: true,
      maxlength: [100, 'Owner name cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
    },
    settings: {
      rentDueDay: {
        type: Number,
        default: 1,
        min: 1,
        max: 28,
      },
      gracePeriodDays: {
        type: Number,
        default: 5,
        min: 0,
        max: 30,
      },
      defaultLateFeePaise: {
        type: Number,
        default: 10000, // 10000 = ₹100
        min: 0,
      },
    },
  },
  {
    timestamps: true,
  },
);

export const Organization = mongoose.model<IOrganization>('Organization', OrganizationSchema);
