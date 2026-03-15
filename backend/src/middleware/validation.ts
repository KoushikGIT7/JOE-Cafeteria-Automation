import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { PAYMENT_TYPES } from '../config/constants';
import { ValidationError } from '../utils/errors';

/**
 * Generic Zod validation middleware factory.
 * Validates req.body against the provided schema.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      throw new ValidationError('Validation failed', details);
    }

    // Replace body with parsed (and coerced) data
    req.body = result.data;
    next();
  };
}

/**
 * Generic Zod validation for query params.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const details = result.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      throw new ValidationError('Invalid query parameters', details);
    }

    req.query = result.data;
    next();
  };
}

// ============================================================
// Order Validation Schemas
// ============================================================

/** Schema for POST /orders request body */
export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid('Invalid menu item ID'),
        quantity: z
          .number()
          .int('Quantity must be a whole number')
          .positive('Quantity must be at least 1')
          .max(50, 'Maximum 50 of a single item'),
        special_instructions: z.string().max(500).optional(),
      })
    )
    .min(1, 'Order must contain at least one item')
    .max(20, 'Maximum 20 distinct items per order'),
  paymentType: z.enum(PAYMENT_TYPES as unknown as [string, ...string[]], {
    errorMap: () => ({ message: `Payment type must be one of: ${PAYMENT_TYPES.join(', ')}` }),
  }),
});

/** Schema for GET /orders query params */
export const getOrdersQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Schema for PATCH /orders/:orderId/cancel */
export const cancelOrderSchema = z.object({
  reason: z.string().max(500).optional(),
});

// ============================================================
// Auth Validation Schemas
// ============================================================

export const registerSchema = z.object({
  firebaseUid: z.string().min(1, 'Firebase UID is required'),
  email: z.string().email('Invalid email address'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
});

export const loginSchema = z.object({
  firebaseUid: z.string().min(1, 'Firebase UID is required'),
});

export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  phone: z.string().min(10, 'Invalid phone number').optional(),
  student_type: z.enum(['hosteler', 'day_scholar']).optional(),
});

// ============================================================
// Menu Validation Schemas
// ============================================================

export const createMenuItemSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  category: z.enum(['Breakfast', 'Lunch', 'Snacks', 'Beverages']),
  price: z.number().positive(),
  cost_price: z.number().positive(),
  image_url: z.string().url().optional(),
  status: z.enum(['active', 'inactive', 'discontinued']).default('active'),
  allergens: z.array(z.string()).optional(),
  prep_time_minutes: z.number().int().positive().optional(),
  calories: z.number().int().positive().optional(),
});

export const updateMenuItemSchema = createMenuItemSchema.partial();

// ============================================================
// Payment Validation Schemas
// ============================================================

export const initiatePaymentSchema = z.object({
  orderId: z.string().uuid('Invalid order ID'),
  amount: z.number().positive('Amount must be positive'),
  paymentType: z.enum(['UPI', 'CARD', 'NET', 'CASH']),
});

export const mockPaymentCallbackSchema = z.object({
  paymentId: z.string().uuid('Invalid payment ID'),
  transactionId: z.string().optional(),
  reason: z.string().optional(),
});
