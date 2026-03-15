import { Response } from 'express';

/**
 * Standardized API response helpers per BACKEND_DEVELOPMENT_PROMPT.md Section 10.
 */

interface SuccessOptions {
  data?: any;
  message?: string;
  meta?: Record<string, any>;
}

interface ErrorOptions {
  code: string;
  message: string;
  statusCode?: number;
  details?: Array<{ field: string; message: string }>;
}

/**
 * Send a standardized success response.
 */
export const sendSuccess = (
  res: Response,
  statusCode: number,
  options: SuccessOptions
): Response => {
  return res.status(statusCode).json({
    success: true,
    ...(options.message && { message: options.message }),
    ...(options.data !== undefined && { data: options.data }),
    meta: {
      timestamp: new Date().toISOString(),
      ...options.meta,
    },
  });
};

/**
 * Send a standardized error response.
 */
export const sendError = (
  res: Response,
  options: ErrorOptions
): Response => {
  const statusCode = options.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    error: {
      code: options.code,
      message: options.message,
      statusCode,
      ...(options.details && { details: options.details }),
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
};
