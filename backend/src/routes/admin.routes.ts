import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';
import { authMiddleware, requireRole } from '../middleware/auth';

const router = Router();

// All routes here require admin role
router.use(authMiddleware);
router.use(requireRole('admin'));

/**
 * @route GET /api/v1/admin/users
 * @desc Get all users with filtering
 */
router.get('/users', adminController.getUsers);

/**
 * @route PATCH /api/v1/admin/users/:userId/role
 * @desc Update a user's role
 */
router.patch('/users/:userId/role', adminController.updateRole);

/**
 * @route POST /api/v1/admin/users/:userId/suspend
 * @desc Suspend a user
 */
router.post('/users/:userId/suspend', adminController.suspendUser);

/**
 * @route GET /api/v1/admin/settings
 * @desc Get system settings
 */
router.get('/settings', adminController.getSettings);

/**
 * @route PATCH /api/v1/admin/settings
 * @desc Update system settings
 */
router.patch('/settings', adminController.updateSettings);

/**
 * @route GET /api/v1/admin/audit-logs
 * @desc Get system audit logs
 */
router.get('/audit-logs', adminController.getAuditLogs);

export default router;
