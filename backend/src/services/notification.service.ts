import { getIO } from '../socket/io';
import { logger } from '../utils/logger';
import { UserRole } from '../config/constants';

export class NotificationService {
  /**
   * Send a real-time notification to a specific user.
   */
  notifyUser(userId: string, event: string, data: any): void {
    try {
      const io = getIO();
      io.to(`user:${userId}`).emit(event, data);
      logger.debug(`Socket event ${event} sent to user ${userId}`);
    } catch (error) {
      logger.error('Failed to send user notification', { userId, event, error });
    }
  }

  /**
   * Broadcast a real-time notification to all users with a specific role.
   */
  broadcastToRole(role: UserRole | 'staff', event: string, data: any): void {
    try {
      const io = getIO();
      io.to(`role:${role}`).emit(event, data);
      logger.debug(`Socket event ${event} broadcasted to role ${role}`);
    } catch (error) {
      logger.error('Failed to broadcast role notification', { role, event, error });
    }
  }

  /**
   * Specialist: Notify student about order status change.
   */
  notifyOrderStatusUpdate(userId: string, orderId: string, status: string): void {
    this.notifyUser(userId, 'order:updated', {
      orderId,
      status,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Specialist: Notify staff about a new order.
   */
  notifyNewOrder(orderId: string, amount: number): void {
    this.broadcastToRole('staff', 'order:created', {
      orderId,
      amount,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Specialist: Notify student about payment success.
   */
  notifyPaymentSuccess(userId: string, orderId: string, transactionId: string): void {
    this.notifyUser(userId, 'payment:confirmed', {
      orderId,
      transactionId,
      timestamp: new Date().toISOString()
    });
  }
}

export const notificationService = new NotificationService();
