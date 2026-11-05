import { Router } from 'express';
import { getBedById, updateBedStatus, updateBed, deleteBed } from '../controllers/bed.controller';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';

const router = Router();

// All routes require authentication and organization scoping
router.use(protect);
router.use(enforceOrgScope);

router.get('/:id', getBedById);
router.put('/:id', updateBed);
router.put('/:id/status', updateBedStatus);
router.delete('/:id', deleteBed);

export default router;
