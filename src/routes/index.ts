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
import checkoutRoutes from './checkout.routes';
import meterRoutes from './meter.routes';
import expenseRoutes from './expense.routes';
import teamRoutes from './team.routes';
import subscriptionRoutes from './subscription.routes';
import uploadRoutes from './upload.routes';
import { enforceSubscription } from '../middleware/enforceSubscription';

const router = Router();

// Mount public sub-routes
router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/subscription', subscriptionRoutes);

// Apply subscription paywall to subsequent routes
router.use(enforceSubscription);

// Protected routes
router.use('/properties', propertyRoutes);
router.use('/property', propertyRoutes);
router.use('/beds', bedRoutes);
router.use('/bed', bedRoutes);
router.use('/checkins', checkinRoutes);
router.use('/checkin', checkinRoutes);
router.use('/tenants', tenantRoutes);
router.use('/tenant', tenantRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/invoice', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/payment', paymentRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/checkouts', checkoutRoutes);
router.use('/checkout', checkoutRoutes);
router.use('/meters', meterRoutes);
router.use('/meter', meterRoutes);
router.use('/expenses', expenseRoutes);
router.use('/expense', expenseRoutes);
router.use('/team', teamRoutes);
router.use('/uploads', uploadRoutes);

export default router;
