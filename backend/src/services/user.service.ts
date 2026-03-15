import { query } from '../config/database';
import { logger } from '../utils/logger';
import { NotFoundError, ConflictError } from '../utils/errors';
import { User } from '../types';
import { UserRole } from '../config/constants';

export class UserService {
  /**
   * Creates a new user in the database.
   */
  async createUser(firebaseUid: string, email: string, name: string): Promise<User> {
    try {
      // Check if user already exists
      const existingUser = await query(`SELECT id FROM users WHERE firebase_uid = $1 OR email = $2`, [firebaseUid, email]);
      if (existingUser.rowCount && existingUser.rowCount > 0) {
        throw new ConflictError('User with this email or Firebase UID already exists');
      }

      const result = await query(
        `INSERT INTO users (firebase_uid, email, name, role, status)
         VALUES ($1, $2, $3, 'student', 'active')
         RETURNING *`,
        [firebaseUid, email, name]
      );
      
      logger.info('User created successfully', { userId: result.rows[0].id, email });
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create user', { error, email, firebaseUid });
      throw error;
    }
  }

  /**
   * Retrieves a user by their internal ID.
   */
  async getUserById(userId: string): Promise<User> {
    const result = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
    if (result.rowCount === 0) {
      throw new NotFoundError('User');
    }
    return result.rows[0];
  }

  /**
   * Retrieves a user by their Firebase UID.
   */
  async getUserByFirebaseUid(firebaseUid: string): Promise<User | null> {
    const result = await query(`SELECT * FROM users WHERE firebase_uid = $1`, [firebaseUid]);
    if (result.rowCount === 0) {
      return null;
    }
    return result.rows[0];
  }

  /**
   * Retrieves a user by their email address.
   */
  async getUserByEmail(email: string): Promise<User> {
    const result = await query(`SELECT * FROM users WHERE email = $1`, [email]);
    if (result.rowCount === 0) {
      throw new NotFoundError('User');
    }
    return result.rows[0];
  }

  /**
   * Updates a user's profile information.
   */
  async updateUserProfile(userId: string, data: Partial<User>): Promise<User> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const allowedFields = ['name', 'phone', 'student_type'];

    for (const [key, value] of Object.entries(data)) {
      if (allowedFields.includes(key) && value !== undefined) {
        updates.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return this.getUserById(userId); // No fields to update
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const updateQuery = `
      UPDATE users 
      SET ${updates.join(', ')} 
      WHERE id = $${paramIndex} 
      RETURNING *
    `;

    const result = await query(updateQuery, values);
    
    if (result.rowCount === 0) {
      throw new NotFoundError('User');
    }

    logger.info('User profile updated', { userId });
    return result.rows[0];
  }

  /**
   * Updates a user's role (Admin operation).
   */
  async updateUserRole(userId: string, newRole: UserRole): Promise<User> {
    const result = await query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newRole, userId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('User');
    }

    logger.info('User role updated', { userId, newRole });
    return result.rows[0];
  }

  /**
   * Lists users with optional role filtering and pagination.
   */
  async listUsers(role?: UserRole, limit: number = 20, offset: number = 0): Promise<{users: User[], total: number}> {
    let whereClause = 'WHERE deleted_at IS NULL';
    const params: any[] = [];
    let paramIndex = 1;

    if (role) {
      whereClause += ` AND role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    const countResult = await query(`SELECT COUNT(*) as total FROM users ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const dataResult = await query(
      `SELECT * FROM users ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    return {
      users: dataResult.rows,
      total
    };
  }
}

export const userService = new UserService();
