import { Router } from 'express';
import orderRoutes from './order.routes';
import authRoutes from './auth.routes';
import menuRoutes from './menu.routes';
import paymentRoutes from './payment.routes';
import adminRoutes from './admin.routes';
import reportingRoutes from './reporting.routes';
import qrRoutes from './qr.routes';

const router = Router();

/**
 * Main API Router
 * Aggregates all route modules under /api/v1/
 *
 * Current routes:
 *   /orders   - Order management (order.routes.ts)
 *
 * Future routes (to be added):
 *   /auth     - Authentication
 *   /payments - Payment processing
 *   /qr       - QR code management
 *   /menu     - Menu management
 *   /admin    - Admin operations
 *   /users    - User management
 */

console.log('Registering routes...');
router.use('/orders', (req, res, next) => { console.log('Hit orders route'); next(); }, orderRoutes);
router.use('/auth', (req, res, next) => { console.log('Hit auth route'); next(); }, authRoutes);
router.use('/menu', (req, res, next) => { console.log('Hit menu route'); next(); }, menuRoutes);
router.use('/payments', (req, res, next) => { console.log('Hit payments route'); next(); }, paymentRoutes);
router.use('/admin', adminRoutes);
router.use('/reports', reportingRoutes);
router.use('/qr', qrRoutes);
console.log('Routes registered.');

// Health check at API level
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'OK',
      service: 'joe-cafeteria-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
