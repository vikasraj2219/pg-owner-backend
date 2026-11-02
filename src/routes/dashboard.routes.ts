import { Router } from 'express';
import { getDashboardStats } from '../controllers/dashboard.controller';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

router.get('/stats', getDashboardStats);

export default router;
