import { Router } from 'express';
import { reportingController } from '../controllers/reporting.controller';
import { authMiddleware, requireRole } from '../middleware/auth';

const router = Router();

// All reporting routes require admin role
router.use(authMiddleware);
router.use(requireRole('admin'));

/**
 * @route GET /api/v1/reports/daily
 * @desc Get daily sales and metrics summary
 */
router.get('/daily', reportingController.getDailyReport);

/**
 * @route GET /api/v1/reports/revenue
 * @desc Get revenue breakdown over a period
 */
router.get('/revenue', reportingController.getRevenueReport);

/**
 * @route GET /api/v1/reports/export
 * @desc Export sales data (CSV)
 */
router.get('/export', reportingController.exportReport);

export default router;
