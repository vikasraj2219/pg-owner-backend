import mongoose, { Document, Schema, Model } from 'mongoose';

export type BedStatus = 'available' | 'occupied' | 'notice_period' | 'maintenance';

export interface IBed extends Document {
  organization: mongoose.Types.ObjectId;
  property: mongoose.Types.ObjectId;
  room: mongoose.Types.ObjectId;
  bedNumber: string; // e.g. "101-A", "101-B"
  status: BedStatus;
  currentTenant?: mongoose.Types.ObjectId;
  noticeEndDate?: Date;
  maintenanceNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BedSchema = new Schema<IBed>(
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
      index: true,
    },
    bedNumber: {
      type: String,
      required: [true, 'Bed number is required'],
      trim: true,
      maxlength: [30, 'Bed number cannot exceed 30 characters'],
    },
    status: {
      type: String,
      enum: {
        values: ['available', 'occupied', 'notice_period', 'maintenance'],
        message:
          '{VALUE} is not a valid bed status (available, occupied, notice_period, maintenance)',
      },
      default: 'available',
      index: true,
    },
    currentTenant: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
    },
    noticeEndDate: {
      type: Date,
      default: null,
    },
    maintenanceNote: {
      type: String,
      trim: true,
      maxlength: [200, 'Maintenance note cannot exceed 200 characters'],
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

// Compound index to guarantee bed numbers are unique per room
BedSchema.index({ room: 1, bedNumber: 1 }, { unique: true });
BedSchema.index({ organization: 1, property: 1, status: 1 });

export const Bed: Model<IBed> = mongoose.models.Bed || mongoose.model<IBed>('Bed', BedSchema);
