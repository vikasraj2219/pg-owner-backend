import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { Subscription, Property, Bed, PLAN_LIMITS, PlanType } from '../models';
import { env } from '../config/env';

export const PLAN_PRICES: Record<PlanType, { amountPaise: number; label: string }> = {
  starter: { amountPaise: 49900, label: 'Starter Plan (₹499/mo)' },
  growth: { amountPaise: 99900, label: 'Growth Plan (₹999/mo)' },
  pro: { amountPaise: 199900, label: 'Pro Enterprise Plan (₹1,999/mo)' },
};

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

/**
 * Create Razorpay Order for Subscription Upgrade
 * POST /api/subscription/create-order
 */
export const createRazorpayOrder = async (
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

    const planConfig = PLAN_PRICES[plan as PlanType];
    const amountPaise = planConfig.amountPaise;
    const keyId = env.RAZORPAY_KEY_ID;
    const keySecret = env.RAZORPAY_KEY_SECRET;

    if (keyId && keySecret) {
      const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: `rcpt_sub_${orgId.toString().slice(-6)}_${Date.now()}`,
          notes: {
            orgId: orgId.toString(),
            plan,
          },
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        throw new AppError(
          errorData?.error?.description || 'Failed to create Razorpay order',
          response.status,
        );
      }

      const orderData = (await response.json()) as any;

      res.status(200).json({
        success: true,
        data: {
          orderId: orderData.id,
          amount: orderData.amount,
          currency: orderData.currency,
          keyId,
          plan,
          planLabel: planConfig.label,
          isMock: false,
        },
      });
      return;
    }

    // Sandbox / Test fallback if keys are not yet configured in .env
    const mockOrderId = `order_mock_${orgId.toString().slice(-6)}_${Date.now()}`;
    res.status(200).json({
      success: true,
      data: {
        orderId: mockOrderId,
        amount: amountPaise,
        currency: 'INR',
        keyId: 'rzp_test_mock_sandbox',
        plan,
        planLabel: planConfig.label,
        isMock: true,
        notice:
          'Sandbox mock active. Add RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET in .env for live gateway.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify Razorpay Payment and Activate Subscription
 * POST /api/subscription/verify
 */
export const verifyRazorpayPayment = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const orgId = req.orgId;
    if (!orgId) throw new AppError('Organization context required', 403);

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;
    if (!razorpay_order_id || !plan) {
      throw new AppError('razorpay_order_id and plan are required', 400);
    }

    const keySecret = env.RAZORPAY_KEY_SECRET;

    // Cryptographic HMAC SHA256 verification if live Razorpay keys are configured
    if (keySecret && !razorpay_order_id.startsWith('order_mock_')) {
      if (!razorpay_payment_id || !razorpay_signature) {
        throw new AppError('razorpay_payment_id and razorpay_signature are required', 400);
      }

      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        throw new AppError('Invalid Razorpay payment signature', 400);
      }
    }

    const limits = PLAN_LIMITS[plan as PlanType];
    const planConfig = PLAN_PRICES[plan as PlanType];
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
    subscription.razorpayOrderId = razorpay_order_id;
    subscription.razorpayPaymentId = razorpay_payment_id || `pay_mock_${Date.now()}`;
    subscription.razorpaySignature = razorpay_signature || 'mock_signature';
    subscription.lastPaymentAmount = (planConfig?.amountPaise || 0) / 100;
    subscription.lastPaymentDate = now;
    await subscription.save();

    res.status(200).json({
      success: true,
      message: `Payment verified! Plan successfully upgraded to ${plan.toUpperCase()} for 30 days.`,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create Razorpay Payment Link (UPI, Cards, NetBanking with deep-link return)
 * POST /api/subscription/payment-link
 */
export const createRazorpayPaymentLink = async (
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

    const planConfig = PLAN_PRICES[plan as PlanType];
    const amountPaise = planConfig.amountPaise;
    const keyId = env.RAZORPAY_KEY_ID;
    const keySecret = env.RAZORPAY_KEY_SECRET;

    if (keyId && keySecret) {
      const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const response = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          description: `Nilaaya PG Management - ${planConfig.label}`,
          notes: {
            orgId: orgId.toString(),
            plan,
          },
          callback_url: 'pgowner://subscription',
          callback_method: 'get',
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        throw new AppError(
          errorData?.error?.description || 'Failed to create Razorpay payment link',
          response.status,
        );
      }

      const linkData = (await response.json()) as any;
      res.status(200).json({
        success: true,
        data: {
          paymentLinkId: linkData.id,
          paymentLinkUrl: linkData.short_url,
          amount: linkData.amount,
          currency: linkData.currency,
          plan,
          isMock: false,
        },
      });
      return;
    }

    // Mock fallback link
    res.status(200).json({
      success: true,
      data: {
        paymentLinkId: `plink_mock_${Date.now()}`,
        paymentLinkUrl: '',
        amount: amountPaise,
        currency: 'INR',
        plan,
        isMock: true,
        notice:
          'Sandbox mock active. Add RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET in .env to generate live checkout URLs.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handle incoming Razorpay Webhooks
 * POST /api/subscription/webhook
 */
export const handleRazorpayWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_KEY_SECRET;

    if (webhookSecret && signature) {
      const bodyString = JSON.stringify(req.body);
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(bodyString)
        .digest('hex');

      if (expectedSignature !== signature) {
        throw new AppError('Invalid webhook signature', 400);
      }
    }

    const event = req.body.event;
    const payload = req.body.payload;

    if (
      event === 'order.paid' ||
      event === 'payment.captured' ||
      event === 'payment_link.paid'
    ) {
      const entity =
        payload?.payment?.entity ||
        payload?.order?.entity ||
        payload?.payment_link?.entity;
      const orgId = entity?.notes?.orgId;
      const plan = entity?.notes?.plan;

      if (orgId && plan && ['starter', 'growth', 'pro'].includes(plan)) {
        const limits = PLAN_LIMITS[plan as PlanType];
        const planConfig = PLAN_PRICES[plan as PlanType];
        const now = new Date();
        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        let subscription = await Subscription.findOne({ organization: orgId });
        if (!subscription) {
          subscription = new Subscription({ organization: orgId });
        }

        subscription.plan = plan as PlanType;
        subscription.status = 'active';
        subscription.maxProperties = limits.maxProperties;
        subscription.maxBeds = limits.maxBeds;
        subscription.currentPeriodEnd = periodEnd;
        subscription.razorpayPaymentId = entity?.id || '';
        subscription.razorpayOrderId = entity?.order_id || '';
        subscription.lastPaymentAmount = (entity?.amount || planConfig?.amountPaise || 0) / 100;
        subscription.lastPaymentDate = now;
        await subscription.save();
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
};
