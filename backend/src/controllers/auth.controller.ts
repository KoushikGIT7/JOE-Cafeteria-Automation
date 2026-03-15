import { Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { userService } from '../services/user.service';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { AuthenticationError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export class AuthController {
  
  /**
   * Register a new user using their Firebase UID
   */
  /**
   * Register a new user using their Firebase UID
   */
  async register(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { firebaseUid, email, name } = req.body;
      
      const user = await userService.createUser(firebaseUid, email, name);
      const tokens = await authService.generateTokens(user.id, user.role);
      
      logger.info('User registered successfully', { userId: user.id });
      
      sendSuccess(res, 201, {
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
          tokens
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login using Firebase UID
   */
  /**
   * Login using Firebase UID
   */
  async login(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { firebaseUid } = req.body;
      
      const user = await userService.getUserByFirebaseUid(firebaseUid);
      if (!user) {
        throw new AuthenticationError('User not found. Please register first.');
      }
      
      if (user.status !== 'active') {
        throw new AuthenticationError('Account is inactive or suspended.');
      }

      const tokens = await authService.generateTokens(user.id, user.role);
      
      logger.info('User logged in', { userId: user.id });
      
      sendSuccess(res, 200, {
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
          tokens
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Refresh access token
   */
  /**
   * Refresh access token
   */
  async refresh(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        throw new ValidationError('Refresh token is required');
      }

      const tokens = await authService.refreshToken(refreshToken);
      
      sendSuccess(res, 200, { data: tokens });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current user profile
   */
  /**
   * Get current user profile
   */
  async getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.userId!;
      const user = await userService.getUserById(userId);
      
      sendSuccess(res, 200, { data: { user } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update current user profile
   */
  /**
   * Update current user profile
   */
  async updateProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.userId!;
      const data = req.body;
      
      const user = await userService.updateUserProfile(userId, data);
      
      sendSuccess(res, 200, { data: { user } });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
