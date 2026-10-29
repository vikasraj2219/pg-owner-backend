import { Router } from 'express';
import healthRoutes from './health.routes';

const router = Router();

// Mount sub-routes
router.use('/', healthRoutes);

export default router;
