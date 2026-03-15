import { query } from '../config/database';
import { logger } from '../utils/logger';
import { notificationService } from './notification.service';
import { NotFoundError } from '../utils/errors';
import { Payment } from '../types';
import { PaymentType } from '../config/constants';

export class PaymentService {
  /**
   * Initializes a mock payment request for an order.
   */
  async initiatePayment(orderId: string, userId: string, amount: number, paymentType: PaymentType): Promise<Payment> {
    const result = await query(
      `INSERT INTO payments (order_id, user_id, amount, payment_method, status, attempt_count, max_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'PENDING', 0, 3, NOW(), NOW())
       RETURNING *`,
      [orderId, userId, amount, paymentType]
    );
    
    logger.info('Mock payment initiated', { orderId, paymentId: result.rows[0].id });
    return result.rows[0];
  }

  /**
   * Mocks a successful payment webhook/callback.
   */
  async simulatePaymentSuccess(paymentId: string, transactionId: string): Promise<Payment> {
    const payment = await this.getPaymentById(paymentId);
    if (payment.status === 'SUCCESS') return payment;

    const result = await query(
      `UPDATE payments 
       SET status = 'SUCCESS', gateway_transaction_id = $1, completed_at = NOW(), updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [transactionId, paymentId]
    );

    // Interlock: Update the corresponding order's payment status to SUCCESS
    await query(
      `UPDATE orders SET payment_status = 'SUCCESS', transaction_id = $1, updated_at = NOW() WHERE id = $2`,
      [transactionId, payment.order_id]
    );

    logger.info('Mock payment marked as success', { paymentId, transactionId });
    
    // ----- Notify student about payment success -----
    notificationService.notifyPaymentSuccess(payment.user_id, payment.order_id, transactionId);
 
    return result.rows[0];
  }

  /**
   * Mocks a failed payment.
   */
  async simulatePaymentFailure(paymentId: string, reason: string): Promise<Payment> {
    const payment = await this.getPaymentById(paymentId);
    
    const result = await query(
      `UPDATE payments 
       SET status = 'FAILED', status_reason = $1, attempt_count = attempt_count + 1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [reason, paymentId]
    );

    // Interlock: Update order's payment status to FAILED
    await query(
      `UPDATE orders SET payment_status = 'FAILED', updated_at = NOW() WHERE id = $1`,
      [payment.order_id]
    );

    logger.warn('Mock payment failed', { paymentId, reason });
    return result.rows[0];
  }

  private async getPaymentById(paymentId: string): Promise<Payment> {
    const result = await query(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
    if (result.rowCount === 0) throw new NotFoundError('Payment');
    return result.rows[0];
  }
}

export const paymentService = new PaymentService();
