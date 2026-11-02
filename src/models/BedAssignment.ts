import mongoose, { Document, Schema, Model } from 'mongoose';

export type BedAssignmentStatus = 'active' | 'vacated' | 'transferred';

export interface IBedAssignment extends Document {
  organization: mongoose.Types.ObjectId;
  property: mongoose.Types.ObjectId;
  room: mongoose.Types.ObjectId;
  bed: mongoose.Types.ObjectId;
  tenant: mongoose.Types.ObjectId;
  startDate: Date;
  endDate?: Date;
  status: BedAssignmentStatus;
  monthlyRentPaise: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BedAssignmentSchema = new Schema<IBedAssignment>(
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
    room: {
      type: Schema.Types.ObjectId,
      ref: 'Room',
      required: [true, 'Room ID is required'],
    },
    bed: {
      type: Schema.Types.ObjectId,
      ref: 'Bed',
      required: [true, 'Bed ID is required'],
      index: true,
    },
    tenant: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'Tenant ID is required'],
      index: true,
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'vacated', 'transferred'],
      default: 'active',
      index: true,
    },
    monthlyRentPaise: {
      type: Number,
      required: [true, 'Monthly rent in paise is required'],
      min: [0, 'Rent cannot be negative'],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
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

BedAssignmentSchema.index({ organization: 1, tenant: 1, status: 1 });
BedAssignmentSchema.index({ bed: 1, status: 1 });

export const BedAssignment: Model<IBedAssignment> =
  mongoose.models.BedAssignment ||
  mongoose.model<IBedAssignment>('BedAssignment', BedAssignmentSchema);
