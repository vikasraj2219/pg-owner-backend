import { Router } from 'express';
import { quickCheckin } from '../controllers/checkin.controller';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';

const router = Router();

// Protect all check-in routes with JWT authentication and organization context
router.use(protect);
router.use(enforceOrgScope);

router.post('/quick', quickCheckin);

export default router;
