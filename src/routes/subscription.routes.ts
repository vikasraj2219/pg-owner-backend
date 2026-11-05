import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import {
  getCurrentSubscription,
  upgradeSubscription,
  scheduleDowngrade,
  cancelDowngrade,
  extendTrial,
  createRazorpayOrder,
  verifyRazorpayPayment,
  createRazorpayPaymentLink,
  handleRazorpayWebhook,
  handlePaymentLinkCallback,
} from '../controllers/subscription.controller';

const router = Router();

// Public routes (called by Razorpay servers & browser redirects)
router.post('/webhook', handleRazorpayWebhook);
router.get('/callback', handlePaymentLinkCallback);

// Authenticated & organization-scoped routes
router.use(protect);
router.use(enforceOrgScope);

router.get('/current', getCurrentSubscription);
router.post('/upgrade', upgradeSubscription);
router.post('/schedule-downgrade', scheduleDowngrade);
router.post('/cancel-downgrade', cancelDowngrade);
router.post('/extend-trial', extendTrial);

// Razorpay Payment Gateway Endpoints
router.post('/create-order', createRazorpayOrder);
router.post('/verify', verifyRazorpayPayment);
router.post('/payment-link', createRazorpayPaymentLink);

export default router;
