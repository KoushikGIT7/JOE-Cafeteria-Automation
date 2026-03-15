import { Request, Response, NextFunction } from 'express';
import { paymentService } from '../services/payment.service';
import { sendSuccess } from '../utils/response';
import { AuthRequest } from '../types';

export class PaymentController {
  
  /**
   * POST /api/v1/payments/initiate
   * Intended to be called after order creation if payment is not cash.
   */
  /**
   * POST /api/v1/payments/initiate
   * Intended to be called after order creation if payment is not cash.
   */
  async initiate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { orderId, amount, paymentType } = req.body;
      const payment = await paymentService.initiatePayment(orderId, req.userId!, amount, paymentType);
      
      // In a real system, we'd return a Razorpay order ID here.
      // For mock, we just return the local payment record.
      sendSuccess(res, 201, { data: { payment } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/payments/mock/success
   * Simulates a successful webhook callback from payment provider.
   */
  /**
   * POST /api/v1/payments/mock/success
   * Simulates a successful webhook callback from payment provider.
   */
  async success(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { paymentId, transactionId } = req.body;
      const payment = await paymentService.simulatePaymentSuccess(paymentId, transactionId || `txn_${Date.now()}`);
      sendSuccess(res, 200, { data: { payment } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/payments/mock/failure
   * Simulates a failed webhook callback from payment provider.
   */
  /**
   * POST /api/v1/payments/mock/failure
   * Simulates a failed webhook callback from payment provider.
   */
  async failure(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { paymentId, reason } = req.body;
      const payment = await paymentService.simulatePaymentFailure(paymentId, reason || 'Insufficient funds');
      sendSuccess(res, 200, { data: { payment } });
    } catch (error) {
      next(error);
    }
  }
}

export const paymentController = new PaymentController();
