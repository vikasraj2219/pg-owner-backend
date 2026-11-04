import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import {
  getCurrentSubscription,
  upgradeSubscription,
  extendTrial,
  createRazorpayOrder,
  verifyRazorpayPayment,
  createRazorpayPaymentLink,
  handleRazorpayWebhook,
} from '../controllers/subscription.controller';

const router = Router();

// Public webhook route (called by Razorpay servers)
router.post('/webhook', handleRazorpayWebhook);

// Authenticated & organization-scoped routes
router.use(protect);
router.use(enforceOrgScope);

router.get('/current', getCurrentSubscription);
router.post('/upgrade', upgradeSubscription);
router.post('/extend-trial', extendTrial);

// Razorpay Payment Gateway Endpoints
router.post('/create-order', createRazorpayOrder);
router.post('/verify', verifyRazorpayPayment);
router.post('/payment-link', createRazorpayPaymentLink);

export default router;
