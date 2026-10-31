import mongoose, { Document, Schema, Model } from 'mongoose';

export type PropertyType = 'boys' | 'girls' | 'coliving';

export interface IProperty extends Document {
  organization: mongoose.Types.ObjectId;
  name: string;
  type: PropertyType;
  address?: string;
  upiVpa: string;
  electricityRatePaisePerUnit: number; // Integer paise, e.g. 1200 = ₹12.00/unit
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PropertySchema = new Schema<IProperty>(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Property name is required'],
      trim: true,
      maxlength: [100, 'Property name cannot exceed 100 characters'],
    },
    type: {
      type: String,
      enum: {
        values: ['boys', 'girls', 'coliving'],
        message: '{VALUE} is not a valid property type (boys, girls, coliving)',
      },
      required: [true, 'Property type is required'],
    },
    address: {
      type: String,
      trim: true,
      maxlength: [250, 'Address cannot exceed 250 characters'],
    },
    upiVpa: {
      type: String,
      required: [true, 'UPI VPA is required for rent collection'],
      trim: true,
      lowercase: true,
    },
    electricityRatePaisePerUnit: {
      type: Number,
      required: [true, 'Electricity rate per unit in paise is required'],
      min: [0, 'Electricity rate per unit cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Electricity rate must be specified in whole integer paise',
      },
      default: 1200, // ₹12.00 per unit
    },
    isActive: {
      type: Boolean,
      default: true,
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

// Compound index to guarantee property names are unique per organization
PropertySchema.index({ organization: 1, name: 1 }, { unique: true });

export const Property: Model<IProperty> =
  mongoose.models.Property || mongoose.model<IProperty>('Property', PropertySchema);

