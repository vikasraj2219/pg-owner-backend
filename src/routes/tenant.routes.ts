import { Router } from 'express';
import {
  getTenants,
  getTenantById,
  updateTenant,
  moveBed,
  deleteTenant,
  restoreTenant,
  vacateTenant,
  setNoticePeriod,
  cancelNoticePeriod,
} from '../controllers/tenant.controller';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';

const router = Router();

// Protect all tenant routes with JWT authentication and organization context
router.use(protect);
router.use(enforceOrgScope);

router.get('/', getTenants);
router.get('/:id', getTenantById);
router.put('/:id', updateTenant);
router.post('/:id/move-bed', moveBed);
router.delete('/:id', deleteTenant);
router.post('/:id/restore', restoreTenant);
router.post('/:id/vacate', vacateTenant);
router.post('/:id/notice', setNoticePeriod);
router.post('/:id/cancel-notice', cancelNoticePeriod);

export default router;
