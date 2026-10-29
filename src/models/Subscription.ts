import mongoose, { Document, Schema, Types } from 'mongoose';

export type PlanType = 'starter' | 'growth' | 'pro';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface ISubscription extends Document {
  organization: Types.ObjectId;
  plan: PlanType;
  status: SubscriptionStatus;
  trialEndsAt: Date;
  currentPeriodEnd: Date;
  maxProperties: number;
  maxBeds: number;
  createdAt: Date;
  updatedAt: Date;
}

export const PLAN_LIMITS: Record<PlanType, { maxProperties: number; maxBeds: number }> = {
  starter: { maxProperties: 1, maxBeds: 30 },
  growth: { maxProperties: 3, maxBeds: 100 },
  pro: { maxProperties: 999, maxBeds: 9999 },
};

const SubscriptionSchema = new Schema<ISubscription>(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization ID is required'],
      unique: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ['starter', 'growth', 'pro'],
      default: 'starter',
      required: true,
    },
    status: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'canceled'],
      default: 'trialing',
      required: true,
    },
    trialEndsAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // +14 days
    },
    currentPeriodEnd: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
    maxProperties: {
      type: Number,
      default: PLAN_LIMITS.starter.maxProperties,
      required: true,
    },
    maxBeds: {
      type: Number,
      default: PLAN_LIMITS.starter.maxBeds,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export const Subscription = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
