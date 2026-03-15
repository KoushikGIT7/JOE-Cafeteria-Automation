import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * HTTP request/response logging middleware.
 * Logs method, path, status code, and duration.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  const { method, path, ip } = req;

  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    const logData = {
      method,
      path,
      statusCode,
      duration: `${duration}ms`,
      ip,
      userAgent: req.get('user-agent')?.substring(0, 100),
    };

    if (statusCode >= 500) {
      logger.error('Request completed with server error', logData);
    } else if (statusCode >= 400) {
      logger.warn('Request completed with client error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
}

export default requestLogger;
