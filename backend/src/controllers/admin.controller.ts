import { Response, NextFunction } from 'express';
import { adminService } from '../services/admin.service';
import { sendSuccess } from '../utils/response';
import { AuthRequest } from '../types';
import { UserRole } from '../config/constants';

export class AdminController {
  /**
   * GET /api/v1/admin/users
   */
  async getUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { role, limit, offset } = req.query;
      const result = await adminService.getAllUsers(
        role as UserRole,
        limit ? parseInt(limit as string, 10) : undefined,
        offset ? parseInt(offset as string, 10) : undefined
      );
      sendSuccess(res, 200, { data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/users/:userId/role
   */
  async updateRole(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const { role } = req.body;
      const user = await adminService.updateUserRole(userId, role as UserRole);
      sendSuccess(res, 200, { data: { user }, message: 'User role updated successfully' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/users/:userId/suspend
   */
  async suspendUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const user = await adminService.suspendUser(userId);
      sendSuccess(res, 200, { data: { user }, message: 'User suspended successfully' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/settings
   */
  async getSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const settings = await adminService.getSettings();
      sendSuccess(res, 200, { data: { settings } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/settings
   */
  async updateSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const settings = await adminService.updateSettings(req.body);
      sendSuccess(res, 200, { data: { settings }, message: 'System settings updated successfully' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/audit-logs
   */
  async getAuditLogs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { limit, offset } = req.query;
      const result = await adminService.getAuditLogs(
        limit ? parseInt(limit as string, 10) : undefined,
        offset ? parseInt(offset as string, 10) : undefined
      );
      sendSuccess(res, 200, { data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
