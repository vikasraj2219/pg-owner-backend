import { Router } from 'express';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import propertyRoutes from './property.routes';
import bedRoutes from './bed.routes';
import checkinRoutes from './checkin.routes';
import tenantRoutes from './tenant.routes';
import invoiceRoutes from './invoice.routes';
import paymentRoutes from './payment.routes';
import dashboardRoutes from './dashboard.routes';

const router = Router();

// Mount sub-routes
router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/properties', propertyRoutes);
router.use('/beds', bedRoutes);
router.use('/checkins', checkinRoutes);
router.use('/tenants', tenantRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
