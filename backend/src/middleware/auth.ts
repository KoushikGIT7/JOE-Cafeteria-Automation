import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../types';
import { UserRole } from '../config/constants';
import { logger } from '../utils/logger';

/**
 * JWT authentication middleware.
 * Extracts and verifies the Bearer token from the Authorization header.
 * Attaches userId and userRole to the request object.
 */
export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: { code: 'NO_TOKEN', message: 'No authentication token provided' },
      });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      role: UserRole;
      type: string;
    };

    if (decoded.type !== 'access') {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN_TYPE', message: 'Invalid token type' },
      });
      return;
    }

    req.userId = decoded.userId;
    req.userRole = decoded.role;

    next();
  } catch (error) {
    logger.warn('Authentication failed', {
      error: error instanceof Error ? error.message : 'Unknown',
      ip: req.ip,
      path: req.path,
    });

    res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    });
  }
}

/**
 * Role-based authorization middleware.
 * Must be used AFTER authMiddleware.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      logger.warn('Authorization failed', {
        userId: req.userId,
        userRole: req.userRole,
        requiredRoles: roles,
        path: req.path,
      });

      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      });
      return;
    }
    next();
  };
}
