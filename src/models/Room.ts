import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IRoom extends Document {
  organization: mongoose.Types.ObjectId;
  property: mongoose.Types.ObjectId;
  floorNumber: number;
  roomNumber: string;
  sharingType: number; // 1 to 20 (number of beds)
  baseRentPaisePerBed: number; // Integer paise, e.g. 850000 = ₹8,500.00
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const RoomSchema = new Schema<IRoom>(
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
    floorNumber: {
      type: Number,
      required: [true, 'Floor number is required'],
      validate: {
        validator: Number.isInteger,
        message: 'Floor number must be an integer',
      },
    },
    roomNumber: {
      type: String,
      required: [true, 'Room number is required'],
      trim: true,
      maxlength: [20, 'Room number cannot exceed 20 characters'],
    },
    sharingType: {
      type: Number,
      required: [true, 'Sharing type (number of beds) is required'],
      min: [1, 'Sharing type must be at least 1 bed'],
      max: [20, 'Sharing type cannot exceed 20 beds'],
      validate: {
        validator: Number.isInteger,
        message: 'Sharing type must be a whole integer',
      },
    },
    baseRentPaisePerBed: {
      type: Number,
      required: [true, 'Base rent per bed in paise is required'],
      min: [0, 'Base rent per bed cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Base rent per bed must be specified in whole integer paise',
      },
    },
    tags: {
      type: [String],
      default: [],
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

// Compound index to ensure unique room numbers per property
RoomSchema.index({ property: 1, roomNumber: 1 }, { unique: true });
RoomSchema.index({ organization: 1, property: 1, floorNumber: 1 });

export const Room: Model<IRoom> = mongoose.models.Room || mongoose.model<IRoom>('Room', RoomSchema);
