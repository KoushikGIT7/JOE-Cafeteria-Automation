import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AppError, ValidationError } from '../utils/errors';

/**
 * Centralized error handler per BACKEND_DEVELOPMENT_PROMPT.md Section 9.
 * Must be registered LAST in the Express middleware chain.
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle known operational errors
  if (error instanceof AppError) {
    logger.warn(`${error.statusCode} ${error.message}`, {
      code: error.code,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    const response: any = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    // Include validation details if available
    if (error instanceof ValidationError && error.details) {
      response.error.details = error.details;
    }

    res.status(error.statusCode).json(response);
    return;
  }

  // Handle unexpected / programming errors
  logger.error('Unexpected error', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : error.message,
      statusCode: 500,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
}
