import { PoolClient } from 'pg';
import { query } from '../config/database';
import { logger } from '../utils/logger';
import { InsufficientStockError } from '../utils/errors';

/**
 * Inventory management service.
 * Handles stock reservation, release, and availability checks.
 * Uses row-level locking (FOR UPDATE) to prevent race conditions.
 */
export class InventoryService {
  /**
   * Reserve stock for an order within a transaction.
   * Uses SELECT … FOR UPDATE to prevent race conditions.
   *
   * @param client - Transaction client (must be within BEGIN/COMMIT)
   * @param menuItemId - The menu item to reserve
   * @param quantity - How many units to reserve
   */
  async reserveStock(
    client: PoolClient,
    menuItemId: string,
    quantity: number
  ): Promise<void> {
    // Lock the inventory row and check availability
    const result = await client.query(
      `SELECT i.current_stock, i.minimum_threshold, i.status, m.name as item_name
       FROM inventory i
       JOIN menu_items m ON i.menu_item_id = m.id
       WHERE i.menu_item_id = $1
       FOR UPDATE`,
      [menuItemId]
    );

    if (result.rows.length === 0) {
      // No inventory row exists — skip stock check (item may not require inventory tracking)
      logger.warn('No inventory record found for menu item', { menuItemId });
      return;
    }

    const inventory = result.rows[0];

    if (inventory.current_stock < quantity) {
      throw new InsufficientStockError(
        inventory.item_name || menuItemId
      );
    }

    // Decrement stock and increment consumed today
    const newStock = inventory.current_stock - quantity;
    let newStatus = 'NORMAL';
    if (newStock === 0) {
      newStatus = 'OUT_OF_STOCK';
    } else if (newStock <= inventory.minimum_threshold) {
      newStatus = 'LOW';
    }

    await client.query(
      `UPDATE inventory
       SET current_stock = $1,
           consumed_today = consumed_today + $2,
           status = $3,
           updated_at = NOW()
       WHERE menu_item_id = $4`,
      [newStock, quantity, newStatus, menuItemId]
    );

    logger.info('Stock reserved', {
      menuItemId,
      quantity,
      remainingStock: newStock,
      newStatus,
    });
  }

  /**
   * Release previously reserved stock (e.g. on order cancellation).
   */
  async releaseStock(
    menuItemId: string,
    quantity: number
  ): Promise<void> {
    const result = await query(
      `UPDATE inventory
       SET current_stock = current_stock + $1,
           consumed_today = GREATEST(consumed_today - $1, 0),
           status = CASE
             WHEN current_stock + $1 > minimum_threshold THEN 'NORMAL'
             WHEN current_stock + $1 > 0 THEN 'LOW'
             ELSE status
           END,
           updated_at = NOW()
       WHERE menu_item_id = $2
       RETURNING current_stock, status`,
      [quantity, menuItemId]
    );

    if (result.rows.length > 0) {
      logger.info('Stock released', {
        menuItemId,
        quantity,
        newStock: result.rows[0].current_stock,
        newStatus: result.rows[0].status,
      });
    }
  }

  /**
   * Check if all items in the order have sufficient stock.
   */
  async checkAvailability(
    items: Array<{ menuItemId: string; quantity: number }>
  ): Promise<{ available: boolean; unavailableItems: string[] }> {
    const unavailableItems: string[] = [];

    for (const item of items) {
      const result = await query(
        `SELECT i.current_stock, m.name
         FROM inventory i
         JOIN menu_items m ON i.menu_item_id = m.id
         WHERE i.menu_item_id = $1`,
        [item.menuItemId]
      );

      if (result.rows.length > 0 && result.rows[0].current_stock < item.quantity) {
        unavailableItems.push(result.rows[0].name);
      }
    }

    return {
      available: unavailableItems.length === 0,
      unavailableItems,
    };
  }
}

export const inventoryService = new InventoryService();
