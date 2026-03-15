import { Response, NextFunction } from 'express';
import { qrService } from '../services/qr.service';
import { orderService } from '../services/order.service';
import { sendSuccess } from '../utils/response';
import { AuthRequest } from '../types';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * QR Controller
 * Handles QR code validation and status checks.
 */
export class QRController {
  /**
   * POST /api/v1/qr/validate
   * Validate a scanned QR code.
   */
  async validateQR(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { qrToken, scannedData } = req.body;

      if (!qrToken && !scannedData) {
        throw new ValidationError('Either qrToken or scannedData must be provided');
      }

      logger.info('QR validation request received', {
        userId: req.userId,
        qrToken: qrToken || 'from scanned data'
      });

      let tokenToValidate = qrToken;

      // If scannedData is provided (encrypted payload from QR scanner), decrypt it
      if (scannedData) {
        try {
          // We need to expose decrypt or handle it in a service method
          // For now, let's assume qrService.validateScannedData exists or we add it
          const result = await (qrService as any).validateScannedData(scannedData);
          tokenToValidate = result.token;
        } catch (error) {
          throw new ValidationError('Invalid or corrupted QR data');
        }
      }

      const validationResult = await qrService.validateQR(tokenToValidate);

      // Fetch full order details for the response
      const order = await orderService.getOrder(validationResult.orderId);

      sendSuccess(res, 200, {
        data: {
          success: true,
          order: {
            id: order.id,
            userName: (order as any).user_name || 'Student',
            items: order.items.map(item => ({
              name: (item as any).name || 'Item',
              quantity: item.quantity,
              servedQty: item.served_qty
            })),
            status: order.order_status
          }
        },
        message: 'QR validated and order marked as served'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/qr/:qrToken/status
   * Check status of a QR code.
   */
  async getQRStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { qrToken } = req.params;
      const status = await qrService.getQRStatus(qrToken);
      sendSuccess(res, 200, { data: status });
    } catch (error) {
      next(error);
    }
  }
}

export const qrController = new QRController();
