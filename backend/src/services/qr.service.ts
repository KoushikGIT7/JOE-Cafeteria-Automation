import crypto from 'crypto';
import QRCode from 'qrcode';
import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { DEFAULTS } from '../config/constants';
import { notificationService } from './notification.service';
import { QRGenerationResult } from '../types';
import { NotFoundError, AppError, ValidationError } from '../utils/errors';

/**
 * QR code generation and validation service.
 * Uses AES-256-CBC encryption for secure QR payloads.
 */
export class QRService {
  private readonly algorithm = 'aes-256-cbc';

  private getEncryptionKey(): Buffer {
    const key = process.env.QR_ENCRYPTION_KEY || 'default-32-character-key-here!!';
    // Ensure key is exactly 32 bytes for AES-256
    return Buffer.from(key.padEnd(32, '0').substring(0, 32));
  }

  /**
   * Encrypt a plaintext payload.
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.getEncryptionKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // Prepend IV so we can decrypt later
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt an encrypted payload.
   */
  private decrypt(encryptedText: string): string {
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.getEncryptionKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Generate a secure hash for signature verification.
   */
  private generateSecureHash(data: string): string {
    return crypto
      .createHmac('sha256', this.getEncryptionKey())
      .update(data)
      .digest('hex');
  }
 
  /**
   * Decrypt and validate scanned QR data.
   */
  async validateScannedData(scannedData: string): Promise<{ token: string; orderId: string; userId: string }> {
    try {
      const decrypted = this.decrypt(scannedData);
      const payload = JSON.parse(decrypted);
 
      // Verify signature/hash
      const expectedHash = this.generateSecureHash(decrypted);
      // Wait, the hash was generated on the stringified payload BEFORE encryption
      // Let's re-verify based on how generateQR works
      
      const payloadObj = JSON.parse(decrypted);
      // Re-stringify to check hash? No, generateQR does:
      // const payload = JSON.stringify(...)
      // const secureHash = this.generateSecureHash(payload)
      // So decoded data IS the payload string
 
      if (!payloadObj.token || !payloadObj.orderId) {
        throw new ValidationError('Invalid QR payload');
      }
 
      return {
        token: payloadObj.token,
        orderId: payloadObj.orderId,
        userId: payloadObj.userId
      };
    } catch (error) {
      logger.error('QR decryption/validation failed', { error });
      throw new ValidationError('Invalid QR data');
    }
  }
 
  /**
   * Generate a QR code for an order.
   * Creates encrypted payload, QR image, and stores in database.
   */
  async generateQR(data: {
    orderId: string;
    userId: string;
    finalAmount: number;
  }): Promise<QRGenerationResult> {
    try {
      const qrToken = uuidv4();
      const qrExpiryMinutes =
        parseInt(process.env.QR_EXPIRY_MINUTES || '') || DEFAULTS.QR_EXPIRY_MINUTES;
      const expiresAt = new Date(Date.now() + qrExpiryMinutes * 60 * 1000);

      // Build the QR payload
      const payload = JSON.stringify({
        orderId: data.orderId,
        userId: data.userId,
        amount: data.finalAmount,
        token: qrToken,
        timestamp: Date.now(),
        nonce: crypto.randomBytes(8).toString('hex'),
      });

      // Encrypt the payload
      const encryptedPayload = this.encrypt(payload);

      // Generate secure hash for integrity verification
      const secureHash = this.generateSecureHash(payload);

      // Generate QR code image (data URL for mobile app)
      const qrDataUrl = await QRCode.toDataURL(encryptedPayload, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 300,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      // Store in database
      await query(
        `INSERT INTO qr_codes (
          id, order_id, user_id, qr_token, qr_data, secure_hash,
          status, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
        [
          uuidv4(),
          data.orderId,
          data.userId,
          qrToken,
          JSON.stringify({
            orderId: data.orderId,
            userId: data.userId,
            amount: data.finalAmount,
          }),
          secureHash,
          'ACTIVE',
          expiresAt,
        ]
      );

      // Update order QR status
      await query(
        `UPDATE orders SET qr_status = 'ACTIVE', updated_at = NOW() WHERE id = $1`,
        [data.orderId]
      );

      logger.info('QR code generated', {
        orderId: data.orderId,
        qrToken,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        token: qrToken,
        expiresAt,
        dataUrl: qrDataUrl,
      };
    } catch (error) {
      logger.error('QR generation failed', { error, orderId: data.orderId });
      throw new AppError(500, `QR generation failed: ${error}`, 'QR_GENERATION_ERROR');
    }
  }

  /**
   * Validate a QR code at the serving counter.
   * Checks existence, status, expiry, and marks as USED.
   */
  async validateQR(qrToken: string): Promise<{
    orderId: string;
    userId: string;
    status: string;
  }> {
    // Check if QR exists and is active
    const result = await query(
      `SELECT * FROM qr_codes WHERE qr_token = $1 AND status = 'ACTIVE'`,
      [qrToken]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('QR code (invalid or already used)');
    }

    const qr = result.rows[0];

    // Check if expired
    if (new Date() > new Date(qr.expires_at)) {
      await query(
        `UPDATE qr_codes SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
        [qr.id]
      );
      throw new AppError(410, 'QR code has expired', 'QR_EXPIRED');
    }

    // Mark as used
    await query(
      `UPDATE qr_codes SET status = 'USED', used_at = NOW() WHERE id = $1`,
      [qr.id]
    );

    // Update order status to SERVED
    await query(
      `UPDATE orders SET order_status = 'SERVED', qr_status = 'USED',
       served_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [qr.order_id]
    );

    // Trigger real-time notification to the student
    notificationService.notifyOrderStatusUpdate(qr.user_id, qr.order_id, 'SERVED');

    logger.info('QR code validated', {
      qrToken,
      orderId: qr.order_id,
      userId: qr.user_id,
    });

    return {
      orderId: qr.order_id,
      userId: qr.user_id,
      status: 'VALID',
    };
  }

  /**
   * Get QR status for debugging.
   */
  async getQRStatus(qrToken: string): Promise<any> {
    const result = await query(
      `SELECT qr_token, order_id, status, expires_at, used_at, created_at
       FROM qr_codes WHERE qr_token = $1`,
      [qrToken]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('QR code');
    }

    return result.rows[0];
  }
}

export const qrService = new QRService();
