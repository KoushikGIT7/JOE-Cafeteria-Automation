import { query } from '../config/database';
import { OrderWithItems } from '../types';

/**
 * Order data access layer.
 * Provides parameterized queries for the orders and order_items tables.
 */
export class OrderModel {
  /**
   * Get a single order with its items by ID.
   */
  async findById(orderId: string): Promise<OrderWithItems | null> {
    const result = await query(
      `SELECT o.*,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', oi.id,
                    'menu_item_id', oi.menu_item_id,
                    'name', mi.name,
                    'quantity', oi.quantity,
                    'unit_price', oi.unit_price,
                    'total_price', oi.total_price,
                    'served_qty', oi.served_qty
                  )
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'::json
              ) as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE o.id = $1
       GROUP BY o.id`,
      [orderId]
    );

    return result.rows[0] || null;
  }

  /**
   * Get orders for a specific user with optional status filter and pagination.
   */
  async findByUserId(
    userId: string,
    options: {
      status?: string;
      limit: number;
      offset: number;
    }
  ): Promise<{ orders: OrderWithItems[]; total: number }> {
    // Count query
    let countQuery = 'SELECT COUNT(*) as total FROM orders WHERE user_id = $1';
    const countParams: any[] = [userId];
    let paramIndex = 2;

    if (options.status) {
      countQuery += ` AND order_status = $${paramIndex}`;
      countParams.push(options.status);
      paramIndex++;
    }

    const countResult = await query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total, 10);

    // Data query
    let dataQuery = `
      SELECT o.*,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', oi.id,
                   'menu_item_id', oi.menu_item_id,
                   'name', mi.name,
                   'quantity', oi.quantity,
                   'unit_price', oi.unit_price,
                   'total_price', oi.total_price,
                   'served_qty', oi.served_qty
                 )
               ) FILTER (WHERE oi.id IS NOT NULL),
               '[]'::json
             ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE o.user_id = $1
    `;
    const dataParams: any[] = [userId];
    let dParamIndex = 2;

    if (options.status) {
      dataQuery += ` AND o.order_status = $${dParamIndex}`;
      dataParams.push(options.status);
      dParamIndex++;
    }

    dataQuery += ` GROUP BY o.id ORDER BY o.created_at DESC`;
    dataQuery += ` LIMIT $${dParamIndex} OFFSET $${dParamIndex + 1}`;
    dataParams.push(options.limit, options.offset);

    const dataResult = await query(dataQuery, dataParams);

    return {
      orders: dataResult.rows,
      total,
    };
  }

  /**
   * Get all orders with optional filters (admin).
   */
  async findAll(options: {
    status?: string;
    paymentStatus?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
    offset: number;
  }): Promise<{ orders: any[]; total: number }> {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (options.status) {
      whereClause += ` AND o.order_status = $${paramIndex++}`;
      params.push(options.status);
    }
    if (options.paymentStatus) {
      whereClause += ` AND o.payment_status = $${paramIndex++}`;
      params.push(options.paymentStatus);
    }
    if (options.fromDate) {
      whereClause += ` AND o.created_at >= $${paramIndex++}`;
      params.push(options.fromDate);
    }
    if (options.toDate) {
      whereClause += ` AND o.created_at <= $${paramIndex++}`;
      params.push(options.toDate);
    }

    // Count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM orders o ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Data with items
    const limitParam = paramIndex++;
    const offsetParam = paramIndex++;
    const dataResult = await query(
      `SELECT o.*,
              u.name as user_name, u.email as user_email,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', oi.id,
                    'name', mi.name,
                    'quantity', oi.quantity,
                    'unit_price', oi.unit_price,
                    'total_price', oi.total_price
                  )
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'::json
              ) as items
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
       ${whereClause}
       GROUP BY o.id, u.name, u.email
       ORDER BY o.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, options.limit, options.offset]
    );

    return { orders: dataResult.rows, total };
  }
}

export const orderModel = new OrderModel();
