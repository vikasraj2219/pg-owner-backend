"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const enforceOrgScope_1 = require("../middleware/enforceOrgScope");
const subscription_controller_1 = require("../controllers/subscription.controller");
const router = (0, express_1.Router)();
// Public routes (called by Razorpay servers & browser redirects)
router.post('/webhook', subscription_controller_1.handleRazorpayWebhook);
router.get('/callback', subscription_controller_1.handlePaymentLinkCallback);
// Authenticated & organization-scoped routes
router.use(auth_1.protect);
router.use(enforceOrgScope_1.enforceOrgScope);
router.get('/current', subscription_controller_1.getCurrentSubscription);
router.post('/upgrade', subscription_controller_1.upgradeSubscription);
router.post('/extend-trial', subscription_controller_1.extendTrial);
// Razorpay Payment Gateway Endpoints
router.post('/create-order', subscription_controller_1.createRazorpayOrder);
router.post('/verify', subscription_controller_1.verifyRazorpayPayment);
router.post('/payment-link', subscription_controller_1.createRazorpayPaymentLink);
exports.default = router;
