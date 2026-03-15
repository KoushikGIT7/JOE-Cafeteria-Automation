import { query } from '../config/database';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';
import { User, SystemSettings } from '../types';
import { UserRole } from '../config/constants';
import { userService } from './user.service';

export class AdminService {
  /**
   * Retrieves all users with pagination and filtering.
   */
  async getAllUsers(role?: UserRole, limit: number = 20, offset: number = 0): Promise<{users: User[], total: number}> {
    return userService.listUsers(role, limit, offset);
  }

  /**
   * Updates a user's role.
   */
  async updateUserRole(userId: string, newRole: UserRole): Promise<User> {
    return userService.updateUserRole(userId, newRole);
  }

  /**
   * Suspends a user.
   */
  async suspendUser(userId: string): Promise<User> {
    const result = await query(
      `UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [userId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('User');
    }

    logger.info('User suspended', { userId });
    return result.rows[0];
  }

  /**
   * Retrieves system settings.
   */
  async getSettings(): Promise<SystemSettings> {
    const result = await query(`SELECT * FROM system_settings WHERE key = 'global'`);
    if (result.rowCount === 0) {
      throw new NotFoundError('System settings');
    }
    return result.rows[0];
  }

  /**
   * Updates system settings.
   */
  async updateSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const allowedFields = [
      'is_maintenance_mode', 
      'accepting_orders', 
      'announcement', 
      'tax_rate', 
      'min_order_value', 
      'max_order_value', 
      'peak_hour_threshold', 
      'auto_settlement_enabled', 
      'qr_expiry_minutes'
    ];

    for (const [key, value] of Object.entries(settings)) {
      if (allowedFields.includes(key) && value !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (fields.length === 0) {
      return this.getSettings();
    }

    fields.push(`updated_at = NOW()`);

    const updateQuery = `
      UPDATE system_settings 
      SET ${fields.join(', ')} 
      WHERE key = 'global' 
      RETURNING *
    `;

    const result = await query(updateQuery, values);
    if (result.rowCount === 0) {
      throw new NotFoundError('System settings');
    }

    logger.info('System settings updated');
    return result.rows[0];
  }

  /**
   * Retrieves audit logs.
   */
  async getAuditLogs(limit: number = 50, offset: number = 0): Promise<{logs: any[], total: number}> {
    const countResult = await query(`SELECT COUNT(*) as total FROM audit_logs`);
    const total = parseInt(countResult.rows[0].total, 10);

    const logsResult = await query(
      `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return {
      logs: logsResult.rows,
      total
    };
  }
}

export const adminService = new AdminService();
