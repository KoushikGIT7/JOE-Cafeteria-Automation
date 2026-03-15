import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

/**
 * Audit logging service.
 * Records all significant data changes for compliance and debugging.
 */
export class AuditService {
  /**
   * Create an audit log entry.
   */
  async log(params: {
    entityType: string;
    entityId?: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'READ' | 'CUSTOM';
    userId?: string;
    ipAddress?: string;
    oldValues?: Record<string, any>;
    newValues?: Record<string, any>;
    changesSummary?: string;
    status?: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
    errorMessage?: string;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_logs (
          id, entity_type, entity_id, action, user_id, ip_address,
          old_values, new_values, changes_summary, status, error_message, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          uuidv4(),
          params.entityType,
          params.entityId || null,
          params.action,
          params.userId || null,
          params.ipAddress || null,
          params.oldValues ? JSON.stringify(params.oldValues) : null,
          params.newValues ? JSON.stringify(params.newValues) : null,
          params.changesSummary || null,
          params.status || 'SUCCESS',
          params.errorMessage || null,
        ]
      );
    } catch (error) {
      // Audit logging should never crash the main operation
      logger.error('Failed to write audit log', {
        error,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
      });
    }
  }

  /**
   * Convenience: log an order creation.
   */
  async logOrderCreation(orderId: string, userId: string, orderData: any): Promise<void> {
    await this.log({
      entityType: 'order',
      entityId: orderId,
      action: 'CREATE',
      userId,
      newValues: orderData,
      changesSummary: `Order ${orderId} created`,
    });
  }

  /**
   * Convenience: log an order status change.
   */
  async logOrderStatusChange(
    orderId: string,
    userId: string,
    oldStatus: string,
    newStatus: string
  ): Promise<void> {
    await this.log({
      entityType: 'order',
      entityId: orderId,
      action: 'UPDATE',
      userId,
      oldValues: { order_status: oldStatus },
      newValues: { order_status: newStatus },
      changesSummary: `Order status changed from ${oldStatus} to ${newStatus}`,
    });
  }

  /**
   * Convenience: log an order cancellation.
   */
  async logOrderCancellation(
    orderId: string,
    userId: string,
    reason?: string
  ): Promise<void> {
    await this.log({
      entityType: 'order',
      entityId: orderId,
      action: 'UPDATE',
      userId,
      newValues: { order_status: 'CANCELLED', reason },
      changesSummary: `Order ${orderId} cancelled${reason ? `: ${reason}` : ''}`,
    });
  }
}

export const auditService = new AuditService();
