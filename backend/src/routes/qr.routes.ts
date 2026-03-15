import { Router } from 'express';
import { qrController } from '../controllers/qr.controller';
import { authMiddleware, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

// Validation schema for QR validation
const validateQRSchema = z.object({
  qrToken: z.string().optional(),
  scannedData: z.string().optional(),
}).refine(data => data.qrToken || data.scannedData, {
  message: "Either qrToken or scannedData must be provided"
});

/**
 * QR Routes
 * /api/v1/qr
 */

// All QR routes require authentication
router.use(authMiddleware);

/**
 * POST /api/v1/qr/validate
 * Validate QR code (Cashier/Server only)
 */
router.post(
  '/validate',
  requireRole('cashier', 'server', 'admin'),
  validateBody(validateQRSchema),
  qrController.validateQR
);

/**
 * GET /api/v1/qr/:qrToken/status
 * Get QR status
 */
router.get(
  '/:qrToken/status',
  qrController.getQRStatus
);

export default router;
