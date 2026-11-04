"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const invoice_controller_1 = require("../controllers/invoice.controller");
const auth_1 = require("../middleware/auth");
const enforceOrgScope_1 = require("../middleware/enforceOrgScope");
const env_1 = require("../config/env");
const router = (0, express_1.Router)();
// Conditional cron / session auth middleware for monthly generation
const cronOrAuthMiddleware = (req, res, next) => {
    const cronSecret = req.headers['x-cron-secret'];
    if (cronSecret && cronSecret === env_1.env.INTERNAL_CRON_SECRET) {
        return next();
    }
    // Otherwise require standard JWT auth & org scope
    (0, auth_1.protect)(req, res, err => {
        if (err)
            return next(err);
        (0, enforceOrgScope_1.enforceOrgScope)(req, res, next);
    });
};
// Route: POST /api/invoices/generate-monthly (Protected by x-cron-secret or authenticated JWT)
router.post('/generate-monthly', cronOrAuthMiddleware, invoice_controller_1.generateMonthlyInvoices);
// All subsequent routes require standard authentication and org scoping
router.use(auth_1.protect);
router.use(enforceOrgScope_1.enforceOrgScope);
router.get('/', invoice_controller_1.getInvoices);
router.get('/payments', invoice_controller_1.getPayments);
router.get('/:id', invoice_controller_1.getInvoiceById);
router.post('/:id/pay', invoice_controller_1.markInvoicePaid);
exports.default = router;
