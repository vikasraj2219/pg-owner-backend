import { Router, Request, Response, NextFunction } from 'express';
import {
  getInvoices,
  getInvoiceById,
  generateMonthlyInvoices,
  markInvoicePaid,
  getPayments,
} from '../controllers/invoice.controller';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import { env } from '../config/env';

const router = Router();

// Conditional cron / session auth middleware for monthly generation
const cronOrAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const cronSecret = req.headers['x-cron-secret'];
  if (cronSecret && cronSecret === env.INTERNAL_CRON_SECRET) {
    return next();
  }
  // Otherwise require standard JWT auth & org scope
  protect(req, res, err => {
    if (err) return next(err);
    enforceOrgScope(req, res, next);
  });
};

// Route: POST /api/invoices/generate-monthly (Protected by x-cron-secret or authenticated JWT)
router.post('/generate-monthly', cronOrAuthMiddleware, generateMonthlyInvoices);

// All subsequent routes require standard authentication and org scoping
router.use(protect);
router.use(enforceOrgScope);

router.get('/', getInvoices);
router.get('/payments', getPayments);
router.get('/:id', getInvoiceById);
router.post('/:id/pay', markInvoicePaid);

export default router;
