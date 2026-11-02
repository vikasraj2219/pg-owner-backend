import { Router } from 'express';
import { getTenants, getTenantById, vacateTenant } from '../controllers/tenant.controller';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';

const router = Router();

// Protect all tenant routes with JWT authentication and organization context
router.use(protect);
router.use(enforceOrgScope);

router.get('/', getTenants);
router.get('/:id', getTenantById);
router.post('/:id/vacate', vacateTenant);

export default router;
