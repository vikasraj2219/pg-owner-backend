import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { Subscription, Property, Bed, PLAN_LIMITS, PlanType } from '../models';

/**
 * Get current subscription status, quotas, and usage
 * GET /api/subscription/current
 */
export const getCurrentSubscription = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) throw new AppError('Organization context required', 403);

    let subscription = await Subscription.findOne({ organization: orgId });
    if (!subscription) {
      // Provision default trial if missing
      subscription = await Subscription.create({
        organization: orgId,
        plan: 'starter',
        status: 'trialing',
      });
    }

    const now = new Date();
    const isTrialExpired =
      subscription.status === 'trialing' && new Date(subscription.trialEndsAt) < now;
    const isSubscriptionExpired =
      subscription.status === 'expired' ||
      subscription.status === 'canceled' ||
      (subscription.status === 'active' && new Date(subscription.currentPeriodEnd) < now);

    const isReadOnly = isTrialExpired || isSubscriptionExpired;

    const daysLeft = Math.max(
      0,
      Math.ceil(
        ((subscription.status === 'trialing'
          ? new Date(subscription.trialEndsAt)
          : new Date(subscription.currentPeriodEnd)
        ).getTime() -
          now.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );

    const propertiesUsed = await Property.countDocuments({ organization: orgId });
    const bedsUsed = await Bed.countDocuments({ organization: orgId });

    res.status(200).json({
      success: true,
      data: {
        plan: subscription.plan,
        status: isReadOnly ? 'expired' : subscription.status,
        isReadOnly,
        daysLeft,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
        maxProperties: subscription.maxProperties,
        maxBeds: subscription.maxBeds,
        propertiesUsed,
        bedsUsed,
        upgradeUrl: 'https://pgowner.com/billing',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Upgrade plan tier (starter -> growth -> pro)
 * POST /api/subscription/upgrade
 */
export const upgradeSubscription = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) throw new AppError('Organization context required', 403);

    const { plan } = req.body;
    if (!plan || !['starter', 'growth', 'pro'].includes(plan)) {
      throw new AppError("Invalid plan. Must be 'starter', 'growth', or 'pro'", 400);
    }

    const limits = PLAN_LIMITS[plan as PlanType];
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days active

    let subscription = await Subscription.findOne({ organization: orgId });
    if (!subscription) {
      subscription = new Subscription({ organization: orgId });
    }

    subscription.plan = plan as PlanType;
    subscription.status = 'active';
    subscription.maxProperties = limits.maxProperties;
    subscription.maxBeds = limits.maxBeds;
    subscription.currentPeriodEnd = periodEnd;
    await subscription.save();

    res.status(200).json({
      success: true,
      message: `Subscription successfully upgraded to ${plan.toUpperCase()} plan. Full access active for 30 days.`,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin or pilot extension of trial
 * POST /api/subscription/extend-trial
 */
export const extendTrial = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) throw new AppError('Organization context required', 403);

    const { days = 14 } = req.body;
    const additionalDays = parseInt(days, 10) || 14;

    const subscription = await Subscription.findOne({ organization: orgId });
    if (!subscription) {
      throw new AppError('Subscription not found', 404);
    }

    const baseDate =
      new Date(subscription.trialEndsAt) > new Date()
        ? new Date(subscription.trialEndsAt)
        : new Date();
    subscription.trialEndsAt = new Date(baseDate.getTime() + additionalDays * 24 * 60 * 60 * 1000);
    subscription.status = 'trialing';
    await subscription.save();

    res.status(200).json({
      success: true,
      message: `Trial extended by ${additionalDays} days until ${subscription.trialEndsAt.toDateString()}`,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

