import { query } from '../config/database';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';
import { MenuItem } from '../types';
import { MENU_CATEGORIES, MenuCategory, DEFAULTS } from '../config/constants';

export class MenuService {
  /**
   * Retrieves all menu items, optionally filtered by category and paginated.
   */
  async getMenu(categoryId?: string, options: { limit: number; offset: number } = { limit: 50, offset: 0 }): Promise<{ items: MenuItem[]; total: number }> {
    const cacheKey = `menu:${categoryId || 'all'}:${options.limit}:${options.offset}`;
    const cachedStr = await cacheService.get(cacheKey);
    if (cachedStr) return JSON.parse(cachedStr) as { items: MenuItem[]; total: number };

    let whereClause = "WHERE status != 'discontinued'";
    const params: any[] = [];
    let paramIndex = 1;

    if (categoryId) {
      whereClause += ` AND category = $${paramIndex}`;
      params.push(categoryId);
      paramIndex++;
    }

    const countResult = await query(`SELECT COUNT(*) as total FROM menu_items ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(options.limit, options.offset);
    const dataResult = await query(
      `SELECT * FROM menu_items ${whereClause} ORDER BY category, name LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    const result = { items: dataResult.rows, total };
    await cacheService.set(cacheKey, JSON.stringify(result), DEFAULTS.CACHE_TTL.MENU);
    
    return result;
  }

  /**
   * Retrieves all available menu categories.
   */
  async getMenuCategories(): Promise<MenuCategory[]> {
    // Return constants directly as they are strongly typed
    return [...MENU_CATEGORIES];
  }

  /**
   * Retrieves a single menu item by ID.
   */
  async getMenuItemById(itemId: string): Promise<MenuItem> {
    const cacheKey = `menu_item:${itemId}`;
    const cachedStr = await cacheService.get(cacheKey);
    if (cachedStr) return JSON.parse(cachedStr) as MenuItem;

    const result = await query(`SELECT * FROM menu_items WHERE id = $1`, [itemId]);
    if (result.rowCount === 0) {
      throw new NotFoundError('Menu Item');
    }

    const item = result.rows[0];
    await cacheService.set(cacheKey, JSON.stringify(item), DEFAULTS.CACHE_TTL.MENU);
    return item;
  }

  /**
   * Searches for active menu items by name or description.
   */
  async searchItems(searchQuery: string): Promise<MenuItem[]> {
    const result = await query(
      `SELECT * FROM menu_items 
       WHERE status != 'discontinued' 
       AND (name ILIKE $1 OR description ILIKE $1)
       ORDER BY name LIMIT 20`,
      [`%${searchQuery}%`]
    );

    return result.rows;
  }

  /**
   * Creates a new menu item (Admin only).
   */
  async createMenuItem(data: Partial<MenuItem>): Promise<MenuItem> {
    const requiredFields = ['name', 'category', 'price', 'cost_price', 'status'];
    const columns = [];
    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        columns.push(key);
        values.push(value);
        placeholders.push(`$${paramIndex}`);
        paramIndex++;
      }
    }

    const result = await query(
      `INSERT INTO menu_items (${columns.join(', ')}) 
       VALUES (${placeholders.join(', ')}) 
       RETURNING *`,
      values
    );

    // Invalidate menu caches
    logger.info('Menu item created', { itemId: result.rows[0].id });
    return result.rows[0];
  }

  /**
   * Updates an existing menu item (Admin only).
   */
  async updateMenuItem(itemId: string, data: Partial<MenuItem>): Promise<MenuItem> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && key !== 'id' && key !== 'created_at') {
        updates.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return this.getMenuItemById(itemId);
    }

    updates.push(`updated_at = NOW()`);
    values.push(itemId);

    const result = await query(
      `UPDATE menu_items 
       SET ${updates.join(', ')} 
       WHERE id = $${paramIndex} 
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Menu Item');
    }

    // Invalidate specific item cache
    await cacheService.del(`menu_item:${itemId}`);
    logger.info('Menu item updated', { itemId });
    return result.rows[0];
  }

  /**
   * Deletes (soft or hard depending on relations) a menu item (Admin only).
   */
  async deleteMenuItem(itemId: string): Promise<void> {
    // Instead of hard delete which might break order history, we set to discontinued
    const result = await query(
      `UPDATE menu_items SET status = 'discontinued', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [itemId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Menu Item');
    }

    await cacheService.del(`menu_item:${itemId}`);
    logger.info('Menu item discontinued', { itemId });
  }
}

export const menuService = new MenuService();
