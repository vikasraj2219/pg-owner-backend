import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import {
  getCheckoutPreview,
  confirmCheckout,
  getSettlementStatements,
  getSettlementStatementById,
} from '../controllers/checkout.controller';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

router.get('/preview/:tenantId', getCheckoutPreview);
router.post('/confirm', confirmCheckout);
router.get('/statements', getSettlementStatements);
router.get('/statements/:id', getSettlementStatementById);

export default router;
