import { Router } from 'express';
import { registerOwner, login, getMe } from '../controllers/auth.controller';
import { protect } from '../middleware/auth';
import { enforceOrgScope } from '../middleware/enforceOrgScope';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register-owner', authLimiter, registerOwner);
router.post('/login', authLimiter, login);
router.get('/me', protect, enforceOrgScope, getMe);

export default router;

