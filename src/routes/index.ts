import { Router } from 'express';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import propertyRoutes from './property.routes';
import bedRoutes from './bed.routes';

const router = Router();

// Mount sub-routes
router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/properties', propertyRoutes);
router.use('/beds', bedRoutes);

export default router;
