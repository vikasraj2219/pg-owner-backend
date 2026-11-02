import { Router } from 'express';
import { getInvoices, markInvoicePaid } from '../controllers/invoice.controller';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

router.get('/', getInvoices);
router.post('/:id/pay', markInvoicePaid);

export default router;
