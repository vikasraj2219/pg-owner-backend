import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import {
  getCurrentSubscription,
  upgradeSubscription,
  extendTrial,
} from '../controllers/subscription.controller';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

router.get('/current', getCurrentSubscription);
router.post('/upgrade', upgradeSubscription);
router.post('/extend-trial', extendTrial);

export default router;

