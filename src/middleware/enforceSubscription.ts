import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { Subscription, Property, Bed } from '../models';
import { verifyToken } from '../services/token.service';

/**
 * Enforce subscription status and read-only mode.
 * - Read requests (GET, HEAD, OPTIONS): ALWAYS allowed so owners never lose access to their data.
 * - Mutating requests (POST, PUT, DELETE, PATCH): Return 402 Payment Required if trial/subscription expired.
 */
export const enforceSubscription = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let orgId = req.orgId;

    // Extract orgId from Bearer token if not yet set by route middleware
    if (!orgId && req.headers.authorization?.startsWith('Bearer ')) {
      const parts = req.headers.authorization.split(' ');
      if (parts[1]) {
        try {
          const decoded = verifyToken(parts[1]);
          if (decoded?.orgId) {
            orgId = decoded.orgId;
            req.orgId = decoded.orgId;
          }
        } catch {
          // Token invalid or expired, will be caught by auth middleware
        }
      }
    }

    if (!orgId) {
      next();
      return;
    }

    // Always allow safe read-only operations
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method.toUpperCase())) {
      next();
      return;
    }

    // Exempt subscription and auth endpoints from paywall
    if (
      req.path.includes('/subscription') ||
      req.path.includes('/auth') ||
      req.path.includes('/health')
    ) {
      next();
      return;
    }

    const subscription = await Subscription.findOne({ organization: orgId });
    if (!subscription) {
      next();
      return;
    }

    const now = new Date();
    const isTrialExpired =
      subscription.status === 'trialing' && new Date(subscription.trialEndsAt) < now;
    const isSubscriptionExpired =
      subscription.status === 'expired' ||
      subscription.status === 'canceled' ||
      (subscription.status === 'active' && new Date(subscription.currentPeriodEnd) < now);

    if (isTrialExpired || isSubscriptionExpired) {
      res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_EXPIRED',
        message:
          'Your free trial or subscription has expired. Your account is currently in read-only mode. Upgrade to unlock full access.',
        data: {
          plan: subscription.plan,
          status: 'expired',
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodEnd: subscription.currentPeriodEnd,
          upgradeUrl: 'https://pgowner.com/billing',
        },
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to check if organization has reached max allowed properties for their plan
 */
export const checkPropertyQuota = async (orgId: string): Promise<boolean> => {
  const subscription = await Subscription.findOne({ organization: orgId });
  if (!subscription) return true;

  const currentCount = await Property.countDocuments({ organization: orgId });
  return currentCount < subscription.maxProperties;
};

/**
 * Helper to check if organization has reached max allowed beds for their plan
 */
export const checkBedQuota = async (
  orgId: string,
  additionalBeds: number = 0,
): Promise<boolean> => {
  const subscription = await Subscription.findOne({ organization: orgId });
  if (!subscription) return true;

  const currentCount = await Bed.countDocuments({ organization: orgId });
  return currentCount + additionalBeds <= subscription.maxBeds;
};
