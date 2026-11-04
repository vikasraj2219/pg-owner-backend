import { Router } from 'express';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import {
  getTeamMembers,
  createTeamMember,
  updateTeamMember,
  removeTeamMember,
} from '../controllers/team.controller';

const router = Router();

router.use(protect);
router.use(enforceOrgScope);

router.get('/members', getTeamMembers);
router.post('/members', createTeamMember);
router.put('/members/:id', updateTeamMember);
router.delete('/members/:id', removeTeamMember);

export default router;
