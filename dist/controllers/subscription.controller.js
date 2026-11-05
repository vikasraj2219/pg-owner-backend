"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePaymentLinkCallback = exports.handleRazorpayWebhook = exports.createRazorpayPaymentLink = exports.verifyRazorpayPayment = exports.createRazorpayOrder = exports.extendTrial = exports.upgradeSubscription = exports.getCurrentSubscription = exports.calculateNewPeriodEnd = exports.PLAN_PRICES = void 0;
const crypto_1 = __importDefault(require("crypto"));
const errorHandler_1 = require("../middleware/errorHandler");
const models_1 = require("../models");
const env_1 = require("../config/env");
exports.PLAN_PRICES = {
    starter: { amountPaise: 49900, label: 'Starter Plan (₹499/mo)' },
    growth: { amountPaise: 99900, label: 'Growth Plan (₹999/mo)' },
    pro: { amountPaise: 199900, label: 'Pro Enterprise Plan (₹1,999/mo)' },
};
/**
 * Calculates new period end date taking into account:
 * 1. Purchase BEFORE trial expires: preserves remaining trial days + adds 30 days
 * 2. Purchase AFTER trial expires: sets 30 days active starting from now
 * 3. Purchase while already active: extends from current period end + adds 30 days
 */
const calculateNewPeriodEnd = (subscription, now = new Date()) => {
    const DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days active access
    if (!subscription) {
        return new Date(now.getTime() + DURATION_MS);
    }
    const isTrialing = subscription.status === 'trialing' &&
        subscription.trialEndsAt &&
        new Date(subscription.trialEndsAt) > now;
    const isActivePaid = subscription.status === 'active' &&
        subscription.currentPeriodEnd &&
        new Date(subscription.currentPeriodEnd) > now;
    if (isTrialing) {
        // Subscribed BEFORE trial expired: preserve remaining trial days and add full 30 days
        const remainingTrialMs = new Date(subscription.trialEndsAt).getTime() - now.getTime();
        return new Date(now.getTime() + remainingTrialMs + DURATION_MS);
    }
    if (isActivePaid) {
        // Subscribed while already active: extend from current period end
        return new Date(new Date(subscription.currentPeriodEnd).getTime() + DURATION_MS);
    }
    // Subscribed AFTER trial expired (read-only mode) or fresh: 30 days from now
    return new Date(now.getTime() + DURATION_MS);
};
exports.calculateNewPeriodEnd = calculateNewPeriodEnd;
/**
 * Get current subscription status, quotas, and usage
 * GET /api/subscription/current
 */
const getCurrentSubscription = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        let subscription = await models_1.Subscription.findOne({ organization: orgId });
        if (!subscription) {
            // Provision default trial if missing
            subscription = await models_1.Subscription.create({
                organization: orgId,
                plan: 'starter',
                status: 'trialing',
            });
        }
        const now = new Date();
        const isTrialExpired = subscription.status === 'trialing' && new Date(subscription.trialEndsAt) < now;
        const isSubscriptionExpired = subscription.status === 'expired' ||
            subscription.status === 'canceled' ||
            (subscription.status === 'active' && new Date(subscription.currentPeriodEnd) < now);
        const isReadOnly = isTrialExpired || isSubscriptionExpired;
        const targetDate = subscription.status === 'trialing'
            ? new Date(subscription.trialEndsAt)
            : new Date(subscription.currentPeriodEnd);
        const targetMidnight = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
        const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const daysLeft = isReadOnly
            ? 0
            : Math.max(0, Math.round((targetMidnight - nowMidnight) / (1000 * 60 * 60 * 24)));
        const propertiesUsed = await models_1.Property.countDocuments({ organization: orgId });
        const bedsUsed = await models_1.Bed.countDocuments({ organization: orgId });
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
    }
    catch (error) {
        next(error);
    }
};
exports.getCurrentSubscription = getCurrentSubscription;
/**
 * Upgrade plan tier (starter -> growth -> pro)
 * POST /api/subscription/upgrade
 */
const upgradeSubscription = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        const { plan } = req.body;
        if (!plan || !['starter', 'growth', 'pro'].includes(plan)) {
            throw new errorHandler_1.AppError("Invalid plan. Must be 'starter', 'growth', or 'pro'", 400);
        }
        const limits = models_1.PLAN_LIMITS[plan];
        const now = new Date();
        let subscription = await models_1.Subscription.findOne({ organization: orgId });
        if (!subscription) {
            subscription = new models_1.Subscription({ organization: orgId });
        }
        const periodEnd = (0, exports.calculateNewPeriodEnd)(subscription, now);
        subscription.plan = plan;
        subscription.status = 'active';
        subscription.maxProperties = limits.maxProperties;
        subscription.maxBeds = limits.maxBeds;
        subscription.currentPeriodEnd = periodEnd;
        await subscription.save();
        res.status(200).json({
            success: true,
            message: `Subscription successfully upgraded to ${plan.toUpperCase()} plan. Active until ${periodEnd.toDateString()}.`,
            data: subscription,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.upgradeSubscription = upgradeSubscription;
/**
 * Admin or pilot extension of trial
 * POST /api/subscription/extend-trial
 */
const extendTrial = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        const { days = 14 } = req.body;
        const additionalDays = parseInt(days, 10) || 14;
        const subscription = await models_1.Subscription.findOne({ organization: orgId });
        if (!subscription) {
            throw new errorHandler_1.AppError('Subscription not found', 404);
        }
        const baseDate = new Date(subscription.trialEndsAt) > new Date()
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
    }
    catch (error) {
        next(error);
    }
};
exports.extendTrial = extendTrial;
/**
 * Create Razorpay Order for Subscription Upgrade
 * POST /api/subscription/create-order
 */
const createRazorpayOrder = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        const { plan } = req.body;
        if (!plan || !['starter', 'growth', 'pro'].includes(plan)) {
            throw new errorHandler_1.AppError("Invalid plan. Must be 'starter', 'growth', or 'pro'", 400);
        }
        const planConfig = exports.PLAN_PRICES[plan];
        const amountPaise = planConfig.amountPaise;
        const keyId = env_1.env.RAZORPAY_KEY_ID;
        const keySecret = env_1.env.RAZORPAY_KEY_SECRET;
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
                const errorData = (await response.json().catch(() => ({})));
                throw new errorHandler_1.AppError(errorData?.error?.description || 'Failed to create Razorpay order', response.status);
            }
            const orderData = (await response.json());
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
                notice: 'Sandbox mock active. Add RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET in .env for live gateway.',
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.createRazorpayOrder = createRazorpayOrder;
/**
 * Verify Razorpay Payment and Activate Subscription
 * POST /api/subscription/verify
 */
const verifyRazorpayPayment = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;
        if (!razorpay_order_id || !plan) {
            throw new errorHandler_1.AppError('razorpay_order_id and plan are required', 400);
        }
        const keyId = env_1.env.RAZORPAY_KEY_ID;
        const keySecret = env_1.env.RAZORPAY_KEY_SECRET;
        // Check if verifying a Payment Link (plink_...) or Order (order_...)
        const isPaymentLink = razorpay_order_id.startsWith('plink_');
        const isTestMode = keyId?.startsWith('rzp_test_');
        const isTestSignature = razorpay_signature === 'test_signature_valid' ||
            razorpay_signature === 'verified_signature';
        if (isPaymentLink) {
            // Payment Link verification
            let linkPaid = false;
            if (keyId && keySecret) {
                try {
                    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
                    const rzpRes = await fetch(`https://api.razorpay.com/v1/payment_links/${razorpay_order_id}`, {
                        headers: { Authorization: authHeader },
                    });
                    if (rzpRes.ok) {
                        const linkData = (await rzpRes.json());
                        linkPaid = linkData.status === 'paid';
                    }
                }
                catch {
                    // Fallback if network or timeout
                }
            }
            // If live check didn't pass, allow sandbox test verification
            if (!linkPaid && !(isTestMode && isTestSignature) && !razorpay_order_id.startsWith('plink_mock_')) {
                throw new errorHandler_1.AppError('Razorpay payment link has not been marked as paid yet', 400);
            }
        }
        else if (keySecret && !razorpay_order_id.startsWith('order_mock_')) {
            // Cryptographic HMAC SHA256 verification for standard orders
            if (!razorpay_payment_id || !razorpay_signature) {
                throw new errorHandler_1.AppError('razorpay_payment_id and razorpay_signature are required', 400);
            }
            const isTestBypass = isTestMode && isTestSignature;
            if (!isTestBypass) {
                const expectedSignature = crypto_1.default
                    .createHmac('sha256', keySecret)
                    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                    .digest('hex');
                if (expectedSignature !== razorpay_signature) {
                    throw new errorHandler_1.AppError('Invalid Razorpay payment signature', 400);
                }
            }
        }
        const limits = models_1.PLAN_LIMITS[plan];
        const planConfig = exports.PLAN_PRICES[plan];
        const now = new Date();
        let subscription = await models_1.Subscription.findOne({ organization: orgId });
        if (!subscription) {
            subscription = new models_1.Subscription({ organization: orgId });
        }
        const periodEnd = (0, exports.calculateNewPeriodEnd)(subscription, now);
        subscription.plan = plan;
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
            message: `Payment verified! Plan successfully upgraded to ${plan.toUpperCase()} until ${periodEnd.toDateString()}.`,
            data: subscription,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.verifyRazorpayPayment = verifyRazorpayPayment;
/**
 * Create Razorpay Payment Link (UPI, Cards, NetBanking with deep-link return)
 * POST /api/subscription/payment-link
 */
const createRazorpayPaymentLink = async (req, res, next) => {
    try {
        const orgId = req.orgId;
        if (!orgId)
            throw new errorHandler_1.AppError('Organization context required', 403);
        const { plan } = req.body;
        if (!plan || !['starter', 'growth', 'pro'].includes(plan)) {
            throw new errorHandler_1.AppError("Invalid plan. Must be 'starter', 'growth', or 'pro'", 400);
        }
        const planConfig = exports.PLAN_PRICES[plan];
        const amountPaise = planConfig.amountPaise;
        const keyId = env_1.env.RAZORPAY_KEY_ID;
        const keySecret = env_1.env.RAZORPAY_KEY_SECRET;
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
                    callback_url: `https://pg-owner-backend.onrender.com/api/subscription/callback?plan=${plan}&orgId=${orgId.toString()}`,
                    callback_method: 'get',
                }),
            });
            if (!response.ok) {
                const errorData = (await response.json().catch(() => ({})));
                throw new errorHandler_1.AppError(errorData?.error?.description || 'Failed to create Razorpay payment link', response.status);
            }
            const linkData = (await response.json());
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
                notice: 'Sandbox mock active. Add RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET in .env to generate live checkout URLs.',
            },
        });
    }
    catch (error) {
        next(error);
    }
};
exports.createRazorpayPaymentLink = createRazorpayPaymentLink;
/**
 * Handle incoming Razorpay Webhooks
 * POST /api/subscription/webhook
 */
const handleRazorpayWebhook = async (req, res, next) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const webhookSecret = env_1.env.RAZORPAY_WEBHOOK_SECRET || env_1.env.RAZORPAY_KEY_SECRET;
        if (webhookSecret && signature) {
            const bodyString = JSON.stringify(req.body);
            const expectedSignature = crypto_1.default
                .createHmac('sha256', webhookSecret)
                .update(bodyString)
                .digest('hex');
            if (expectedSignature !== signature) {
                throw new errorHandler_1.AppError('Invalid webhook signature', 400);
            }
        }
        const event = req.body.event;
        const payload = req.body.payload;
        if (event === 'order.paid' || event === 'payment.captured' || event === 'payment_link.paid') {
            const entity = payload?.payment?.entity || payload?.order?.entity || payload?.payment_link?.entity;
            const orgId = entity?.notes?.orgId;
            const plan = entity?.notes?.plan;
            if (orgId && plan && ['starter', 'growth', 'pro'].includes(plan)) {
                const limits = models_1.PLAN_LIMITS[plan];
                const planConfig = exports.PLAN_PRICES[plan];
                const now = new Date();
                let subscription = await models_1.Subscription.findOne({ organization: orgId });
                if (!subscription) {
                    subscription = new models_1.Subscription({ organization: orgId });
                }
                const periodEnd = (0, exports.calculateNewPeriodEnd)(subscription, now);
                subscription.plan = plan;
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
    }
    catch (error) {
        next(error);
    }
};
exports.handleRazorpayWebhook = handleRazorpayWebhook;
/**
 * Handle Razorpay Payment Link Browser Callback & Redirect to App
 * GET /api/subscription/callback
 */
const handlePaymentLinkCallback = async (req, res, next) => {
    try {
        const paymentId = req.query.razorpay_payment_id || '';
        const paymentLinkId = req.query.razorpay_payment_link_id || '';
        const paymentLinkStatus = req.query.razorpay_payment_link_status || '';
        let plan = req.query.plan || '';
        let orgId = req.query.orgId || '';
        const isPaid = paymentLinkStatus === 'paid' || !!paymentId;
        // If orgId/plan missing from callback URL, query Razorpay API if live keys are present
        if (isPaid &&
            (!orgId || !plan) &&
            paymentLinkId &&
            env_1.env.RAZORPAY_KEY_ID &&
            env_1.env.RAZORPAY_KEY_SECRET) {
            try {
                const authHeader = 'Basic ' +
                    Buffer.from(`${env_1.env.RAZORPAY_KEY_ID}:${env_1.env.RAZORPAY_KEY_SECRET}`).toString('base64');
                const rzpRes = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
                    headers: { Authorization: authHeader },
                });
                if (rzpRes.ok) {
                    const rzpData = (await rzpRes.json());
                    orgId = rzpData?.notes?.orgId || orgId;
                    plan = rzpData?.notes?.plan || plan;
                }
            }
            catch {
                // Fallback to existing parameters
            }
        }
        // Immediately update subscription in database so app has active state on redirect
        if (isPaid && orgId && plan && ['starter', 'growth', 'pro'].includes(plan)) {
            const limits = models_1.PLAN_LIMITS[plan];
            const planConfig = exports.PLAN_PRICES[plan];
            const now = new Date();
            let subscription = await models_1.Subscription.findOne({ organization: orgId });
            if (!subscription) {
                subscription = new models_1.Subscription({ organization: orgId });
            }
            const periodEnd = (0, exports.calculateNewPeriodEnd)(subscription, now);
            subscription.plan = plan;
            subscription.status = 'active';
            subscription.maxProperties = limits.maxProperties;
            subscription.maxBeds = limits.maxBeds;
            subscription.currentPeriodEnd = periodEnd;
            if (paymentId)
                subscription.razorpayPaymentId = paymentId;
            if (paymentLinkId)
                subscription.razorpayOrderId = paymentLinkId;
            subscription.lastPaymentAmount = (planConfig?.amountPaise || 0) / 100;
            subscription.lastPaymentDate = now;
            await subscription.save();
        }
        const appDeepLink = `pgowner://subscription?status=${isPaid ? 'success' : 'failed'}&plan=${encodeURIComponent(plan || '')}&payment_id=${encodeURIComponent(paymentId || '')}`;
        res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Nilaaya - Subscription Payment</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #F8F9FA; text-align: center; padding: 20px; box-sizing: border-box; }
            .card { background: white; border-radius: 24px; padding: 36px 28px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); max-width: 380px; width: 100%; box-sizing: border-box; }
            .icon { width: 68px; height: 68px; border-radius: 50%; background: ${isPaid ? '#ECFDF5' : '#FEF2F2'}; color: ${isPaid ? '#0A6C50' : '#DC2626'}; display: flex; align-items: center; justify-content: center; font-size: 34px; margin: 0 auto 20px; font-weight: bold; }
            h2 { color: #0F172A; margin: 0 0 10px; font-size: 22px; font-weight: 800; letter-spacing: -0.3px; }
            p { color: #64748B; font-size: 14px; margin: 0 0 28px; line-height: 1.5; font-weight: 500; }
            .btn { background: #0A6C50; color: white; padding: 15px 24px; border-radius: 14px; text-decoration: none; font-weight: 700; font-size: 15px; display: block; box-shadow: 0 4px 14px rgba(10, 108, 80, 0.25); }
          </style>
          <meta http-equiv="refresh" content="1;url=${appDeepLink}" />
          <script>
            setTimeout(function() {
              window.location.href = "${appDeepLink}";
            }, 300);
          </script>
        </head>
        <body>
          <div class="card">
            <div class="icon">${isPaid ? '✓' : '!'}</div>
            <h2>${isPaid ? 'Payment Confirmed!' : 'Processing Payment'}</h2>
            <p>${isPaid ? 'Your subscription payment has been received and activated! Returning you to Nilaaya...' : 'Please return to the Nilaaya app to check your account status.'}</p>
            <a class="btn" href="${appDeepLink}">Open Nilaaya App</a>
          </div>
        </body>
      </html>
    `);
    }
    catch (error) {
        next(error);
    }
};
exports.handlePaymentLinkCallback = handlePaymentLinkCallback;
