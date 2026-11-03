import { Router } from 'express';
import { getPayments } from '../controllers/invoice.controller';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

router.get('/', getPayments);

export default router;
