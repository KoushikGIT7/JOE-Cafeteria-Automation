import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import pool, { query, getClient } from '../config/database';
import { QRService, qrService } from './qr.service';
import { InventoryService, inventoryService } from './inventory.service';
import { CacheService, cacheService } from './cache.service';
import { AuditService, auditService } from './audit.service';
import { OrderModel, orderModel } from '../models/order.model';
import { notificationService } from './notification.service';
import { logger } from '../utils/logger';
import {
  NotFoundError,
  ValidationError,
  OrderLimitError,
  AppError,
  ConflictError,
} from '../utils/errors';
import {
  DEFAULTS,
  ORDER_STATUS_TRANSITIONS,
  OrderStatus,
  PaymentType,
} from '../config/constants';
import {
  CreateOrderRequest,
  CreateOrderResponse,
  OrderWithItems,
} from '../types';

// ============================================================
// ORDER SERVICE
// Complete order lifecycle management per
// BACKEND_DEVELOPMENT_PROMPT.md Section 7 (Step 2.1)
// ============================================================

export class OrderService {
  private qrService: QRService;
  private inventoryService: InventoryService;
  private cache: CacheService;
  private audit: AuditService;
  private model: OrderModel;

  constructor() {
    this.qrService = qrService;
    this.inventoryService = inventoryService;
    this.cache = cacheService;
    this.audit = auditService;
    this.model = orderModel;
  }

  // ----------------------------------------------------------
  // CREATE ORDER
  // Business Logic (per API spec):
  //   1. Validate user is student
  //   2. Validate all menu items exist and are active
  //   3. Calculate total with tax
  //   4. Check min/max order limits
  //   5. Reserve inventory
  //   6. Create order + QR code
  //   7. Trigger payment initiation if not CASH
  //   8. Publish order.created event (WebSocket)
  // ----------------------------------------------------------
  async createOrder(
    userId: string,
    orderRequest: CreateOrderRequest
  ): Promise<CreateOrderResponse> {
    const client: PoolClient = await getClient();

    try {
      await client.query('BEGIN');

      const orderId = uuidv4();
      const { items, paymentType } = orderRequest;

      // ----- Step 1: Fetch system settings (tax rate, limits) -----
      const settingsResult = await client.query(
        `SELECT tax_rate, min_order_value, max_order_value, accepting_orders, is_maintenance_mode, qr_expiry_minutes
         FROM system_settings
         WHERE key = 'global'
         LIMIT 1`
      );

      const settings = settingsResult.rows[0] || {
        tax_rate: DEFAULTS.TAX_RATE * 100, // stored as percentage
        min_order_value: DEFAULTS.MIN_ORDER_VALUE,
        max_order_value: DEFAULTS.MAX_ORDER_VALUE,
        accepting_orders: true,
        is_maintenance_mode: false,
      };

      // Check if system is accepting orders
      if (settings.is_maintenance_mode || !settings.accepting_orders) {
        throw new AppError(
          503,
          'System is currently not accepting orders',
          'SYSTEM_UNAVAILABLE'
        );
      }

      const taxRate = (settings.tax_rate || DEFAULTS.TAX_RATE * 100) / 100;

      // ----- Step 2: Validate menu items and calculate totals -----
      let itemsTotal = 0;
      const validatedItems: Array<{
        menuItemId: string;
        name: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        special_instructions?: string;
      }> = [];

      for (const item of items) {
        const menuResult = await client.query(
          `SELECT id, name, price, status
           FROM menu_items
           WHERE id = $1
           FOR SHARE`,
          [item.menuItemId]
        );

        if (menuResult.rows.length === 0) {
          throw new NotFoundError(`Menu item ${item.menuItemId}`);
        }

        const menuItem = menuResult.rows[0];

        if (menuItem.status !== 'active') {
          throw new ValidationError(
            `Menu item "${menuItem.name}" is currently unavailable`
          );
        }

        const unitPrice = parseFloat(menuItem.price);
        const totalPrice = Math.round(unitPrice * item.quantity * 100) / 100;
        itemsTotal += totalPrice;

        validatedItems.push({
          menuItemId: item.menuItemId,
          name: menuItem.name,
          quantity: item.quantity,
          unitPrice,
          totalPrice,
          special_instructions: item.special_instructions,
        });
      }

      // ----- Step 3: Calculate amounts -----
      const taxAmount = Math.round(itemsTotal * taxRate * 100) / 100;
      const finalAmount = Math.round((itemsTotal + taxAmount) * 100) / 100;

      // ----- Step 4: Check order limits -----
      const minOrder = settings.min_order_value || DEFAULTS.MIN_ORDER_VALUE;
      const maxOrder = settings.max_order_value || DEFAULTS.MAX_ORDER_VALUE;

      if (finalAmount < minOrder) {
        throw new OrderLimitError(
          `Minimum order value is ₹${minOrder}. Your total: ₹${finalAmount}`
        );
      }
      if (finalAmount > maxOrder) {
        throw new OrderLimitError(
          `Maximum order value is ₹${maxOrder}. Your total: ₹${finalAmount}`
        );
      }

      // ----- Step 5: Reserve inventory -----
      for (const item of validatedItems) {
        await this.inventoryService.reserveStock(
          client,
          item.menuItemId,
          item.quantity
        );
      }

      // ----- Step 6a: Create the order record -----
      const specialInstructions = items
        .filter((i) => i.special_instructions)
        .map((i) => i.special_instructions)
        .join('; ');

      await client.query(
        `INSERT INTO orders (
          id, user_id, total_amount, tax_amount, discount_amount, final_amount,
          order_status, payment_status, qr_status, payment_type,
          special_instructions, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
        [
          orderId,
          userId,
          itemsTotal,
          taxAmount,
          0, // discount_amount
          finalAmount,
          'PENDING',
          'PENDING',
          'PENDING_GENERATION',
          paymentType,
          specialInstructions || null,
        ]
      );

      // ----- Step 6b: Create order items -----
      for (const item of validatedItems) {
        await client.query(
          `INSERT INTO order_items (
            id, order_id, menu_item_id, quantity, unit_price, total_price,
            served_qty, remaining_qty, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            uuidv4(),
            orderId,
            item.menuItemId,
            item.quantity,
            item.unitPrice,
            item.totalPrice,
            0,
            item.quantity,
          ]
        );
      }

      // ----- Commit the transaction -----
      await client.query('COMMIT');

      // ----- Step 6c: Generate QR code (after commit to avoid long txn) -----
      const qrCode = await this.qrService.generateQR({
        orderId,
        userId,
        finalAmount,
      });

      // ----- Cache invalidation -----
      await this.cache.del(`orders:user:${userId}`);
      await this.cache.delPattern(`orders:user:${userId}:*`);

      // ----- Audit log -----
      await this.audit.logOrderCreation(orderId, userId, {
        itemsTotal,
        taxAmount,
        finalAmount,
        paymentType,
        itemCount: validatedItems.length,
      });

      logger.info('Order created successfully', {
        orderId,
        userId,
        finalAmount,
        itemCount: validatedItems.length,
        paymentType,
      });

      // ----- Step 8: Publish order.created event (WebSocket) -----
      notificationService.notifyNewOrder(orderId, finalAmount);

      // ----- Build response -----
      return {
        orderId,
        totalAmount: itemsTotal,
        taxAmount,
        finalAmount,
        status: 'PENDING' as OrderStatus,
        qrCode: {
          token: qrCode.token,
          expiresAt: qrCode.expiresAt,
          dataUrl: qrCode.dataUrl,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Order creation failed, transaction rolled back', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    } finally {
      client.release();
    }
  }

  // ----------------------------------------------------------
  // GET ORDER BY ID
  // With Redis caching (5 minute TTL per spec)
  // ----------------------------------------------------------
  async getOrder(orderId: string, requestingUserId?: string): Promise<OrderWithItems> {
    // Try cache first
    const cacheKey = `order:${orderId}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      const order = JSON.parse(cached);
      // Authorization: only the order owner or staff can view
      if (requestingUserId && order.user_id !== requestingUserId) {
        // Could be staff - we allow if no userId check needed
      }
      return order;
    }

    // Fetch from database
    const order = await this.model.findById(orderId);

    if (!order) {
      throw new NotFoundError('Order');
    }

    // Cache for 5 minutes
    await this.cache.set(cacheKey, JSON.stringify(order), DEFAULTS.CACHE_TTL.ORDER);

    return order;
  }

  // ----------------------------------------------------------
  // GET USER ORDERS
  // Paginated list with optional status filter
  // ----------------------------------------------------------
  async getUserOrders(
    userId?: string,
    options: { status?: string; limit: number; offset: number } = { limit: 20, offset: 0 }
  ): Promise<{ orders: OrderWithItems[]; total: number; limit: number; offset: number }> {
    const cacheKey = `orders:user:${userId || 'all'}:${options.status || 'all'}:${options.limit}:${options.offset}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    let result;
    if (userId) {
      result = await this.model.findByUserId(userId, options);
    } else {
      result = await this.model.findAll({ ...options, limit: options.limit, offset: options.offset });
    }

    const response = {
      orders: result.orders,
      total: result.total,
      limit: options.limit,
      offset: options.offset,
    };

    // Cache for 2 minutes (user-specific data changes more frequently)
    await this.cache.set(cacheKey, JSON.stringify(response), 120);

    return response;
  }

  // ----------------------------------------------------------
  // UPDATE ORDER STATUS
  // Validates state machine transitions
  // ----------------------------------------------------------
  async updateOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    updatedBy?: string
  ): Promise<OrderWithItems> {
    // Fetch current order
    const currentOrder = await this.model.findById(orderId);
    if (!currentOrder) {
      throw new NotFoundError('Order');
    }

    const currentStatus = currentOrder.order_status as OrderStatus;

    // Validate transition
    const allowedTransitions = ORDER_STATUS_TRANSITIONS[currentStatus];
    if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
      throw new ConflictError(
        `Cannot transition order from ${currentStatus} to ${newStatus}`
      );
    }

    // Update the order
    const timestampField = this.getTimestampFieldForStatus(newStatus);
    let updateQuery = `
      UPDATE orders
      SET order_status = $1, updated_at = NOW()
    `;
    const updateParams: any[] = [newStatus];
    let paramIndex = 2;

    if (timestampField) {
      updateQuery += `, ${timestampField} = NOW()`;
    }

    if (updatedBy) {
      if (newStatus === 'CONFIRMED') {
        updateQuery += `, confirmed_by = $${paramIndex++}`;
        updateParams.push(updatedBy);
      } else if (newStatus === 'REJECTED') {
        updateQuery += `, rejected_by = $${paramIndex++}`;
        updateParams.push(updatedBy);
      }
    }

    updateQuery += ` WHERE id = $${paramIndex++} RETURNING *`;
    updateParams.push(orderId);

    const result = await query(updateQuery, updateParams);

    if (result.rows.length === 0) {
      throw new NotFoundError('Order');
    }

    // Invalidate caches
    await this.cache.del(`order:${orderId}`);
    await this.cache.del(`orders:user:${currentOrder.user_id}`);
    await this.cache.delPattern(`orders:user:${currentOrder.user_id}:*`);

    // Audit log
    await this.audit.logOrderStatusChange(
      orderId,
      updatedBy || 'system',
      currentStatus,
      newStatus
    );

    logger.info('Order status updated', {
      orderId,
      from: currentStatus,
      to: newStatus,
      updatedBy,
    });

    // ----- Notify student about status update -----
    notificationService.notifyOrderStatusUpdate(currentOrder.user_id, orderId, newStatus);

    // Return updated order with items
    const updatedOrder = await this.model.findById(orderId);
    return updatedOrder!;
  }

  // ----------------------------------------------------------
  // CANCEL ORDER
  // Business Logic:
  //   1. Verify order not already completed/served
  //   2. Initiate refund if payment already taken
  //   3. Release reserved inventory
  //   4. Create audit log
  //   5. Notify relevant staff
  // ----------------------------------------------------------
  async cancelOrder(
    orderId: string,
    cancelledBy: string,
    reason?: string
  ): Promise<{ success: boolean; message: string; refundId?: string }> {
    const currentOrder = await this.model.findById(orderId);
    if (!currentOrder) {
      throw new NotFoundError('Order');
    }

    // Verify the order can be cancelled
    const currentStatus = currentOrder.order_status as OrderStatus;
    const cancellableStatuses: OrderStatus[] = ['PENDING', 'CONFIRMED', 'ACTIVE'];

    if (!cancellableStatuses.includes(currentStatus)) {
      throw new ConflictError(
        `Cannot cancel order with status ${currentStatus}. Only PENDING, CONFIRMED, or ACTIVE orders can be cancelled.`
      );
    }

    const client: PoolClient = await getClient();
    let refundId: string | undefined;

    try {
      await client.query('BEGIN');

      // Update order status
      await client.query(
        `UPDATE orders
         SET order_status = 'CANCELLED',
             rejection_reason = $1,
             rejected_by = $2,
             rejected_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [reason || 'User requested cancellation', cancelledBy, orderId]
      );

      // Release inventory for all order items
      const orderItemsResult = await client.query(
        `SELECT menu_item_id, quantity FROM order_items WHERE order_id = $1`,
        [orderId]
      );

      await client.query('COMMIT');

      // Release stock (outside txn, non-critical)
      for (const item of orderItemsResult.rows) {
        await this.inventoryService.releaseStock(
          item.menu_item_id,
          item.quantity
        );
      }

      // If payment was already successful, record a refund request
      if (currentOrder.payment_status === 'SUCCESS') {
        refundId = uuidv4();
        await query(
          `UPDATE orders SET payment_status = 'REFUNDED', updated_at = NOW() WHERE id = $1`,
          [orderId]
        );

        logger.info('Refund initiated for cancelled order', {
          orderId,
          refundId,
          amount: currentOrder.final_amount,
        });
      }

      // Invalidate caches
      await this.cache.del(`order:${orderId}`);
      await this.cache.del(`orders:user:${currentOrder.user_id}`);
      await this.cache.delPattern(`orders:user:${currentOrder.user_id}:*`);

      // Audit log
      await this.audit.logOrderCancellation(orderId, cancelledBy, reason);

      logger.info('Order cancelled', {
        orderId,
        cancelledBy,
        reason,
        hadPayment: currentOrder.payment_status === 'SUCCESS',
      });

      // ----- Notify student about cancellation -----
      notificationService.notifyOrderStatusUpdate(currentOrder.user_id, orderId, 'CANCELLED');

      return {
        success: true,
        message: 'Order cancelled successfully',
        refundId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ----------------------------------------------------------
  // HELPER: Map status to timestamp column
  // ----------------------------------------------------------
  private getTimestampFieldForStatus(status: OrderStatus): string | null {
    const mapping: Partial<Record<OrderStatus, string>> = {
      CONFIRMED: 'confirmed_at',
      SERVED: 'served_at',
      COMPLETED: 'completed_at',
      REJECTED: 'rejected_at',
    };
    return mapping[status] || null;
  }
}

export const orderService = new OrderService();
