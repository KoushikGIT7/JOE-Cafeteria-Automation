import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { UserRole } from '../config/constants';
import { logger } from '../utils/logger';
import { AuthenticationError } from '../utils/errors';

export class AuthService {
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'your-super-secure-jwt-secret-min-32-chars';
  private readonly JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-min-32-chars';
  private readonly JWT_EXPIRE_IN = process.env.JWT_EXPIRE_IN || '1h';
  private readonly JWT_REFRESH_EXPIRE_IN = process.env.JWT_REFRESH_EXPIRE_IN || '7d';

  /**
   * Generates a pair of access and refresh tokens.
   */
  async generateTokens(userId: string, role: UserRole): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const accessToken = jwt.sign(
        { userId, role, type: 'access' },
        this.JWT_SECRET as jwt.Secret,
        { expiresIn: this.JWT_EXPIRE_IN as any }
      );

      const refreshToken = jwt.sign(
        { userId, role, type: 'refresh' },
        this.JWT_REFRESH_SECRET as jwt.Secret,
        { expiresIn: this.JWT_REFRESH_EXPIRE_IN as any }
      );

      return { accessToken, refreshToken };
    } catch (error) {
      logger.error('Token generation failed', { error });
      throw new Error('Failed to generate tokens');
    }
  }

  /**
   * Verifies an access token and returns the decoded payload.
   */
  async verifyToken(token: string): Promise<{ userId: string; role: UserRole; type: string }> {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET) as { userId: string; role: UserRole; type: string };
      if (decoded.type !== 'access') {
        throw new AuthenticationError('Invalid token type');
      }
      return decoded;
    } catch (error) {
      throw new AuthenticationError('Invalid or expired token');
    }
  }

  /**
   * Refreshes an access token using a valid refresh token.
   */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string }> {
    try {
      const decoded = jwt.verify(refreshToken, this.JWT_REFRESH_SECRET) as { userId: string; role: UserRole; type: string };
      
      if (decoded.type !== 'refresh') {
        throw new AuthenticationError('Invalid token type for refresh');
      }

      const accessToken = jwt.sign(
        { userId: decoded.userId, role: decoded.role, type: 'access' },
        this.JWT_SECRET as jwt.Secret,
        { expiresIn: this.JWT_EXPIRE_IN as any }
      );

      return { accessToken };
    } catch (error) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }
  }

  /**
   * Hashes a plaintext password (if used in the future, currently we use Firebase UID).
   */
  async hashPassword(plaintext: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(plaintext, saltRounds);
  }

  /**
   * Validates a plaintext password against a hash.
   */
  async validatePassword(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}

export const authService = new AuthService();
