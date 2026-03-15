import { Response, NextFunction } from 'express';
import { OrderService, orderService } from '../services/order.service';
import { AuthRequest, CreateOrderRequest } from '../types';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';
import { OrderStatus } from '../config/constants';

/**
 * Order controller — Express request handlers for all order endpoints.
 * Delegates business logic to OrderService.
 */
export class OrderController {
  private service: OrderService;

  constructor() {
    this.service = orderService;
  }

  // ----------------------------------------------------------
  // POST /api/v1/orders
  // Create a new order
  // ----------------------------------------------------------
  createOrder = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const orderRequest: CreateOrderRequest = req.body;

      logger.info('Order creation request received', {
        userId,
        itemCount: orderRequest.items.length,
        paymentType: orderRequest.paymentType,
      });

      const result = await this.service.createOrder(userId, orderRequest);

      sendSuccess(res, 201, {
        data: {
          orderId: result.orderId,
          totalAmount: result.totalAmount,
          taxAmount: result.taxAmount,
          finalAmount: result.finalAmount,
          status: result.status,
          qrCode: {
            token: result.qrCode.token,
            expiresAt: result.qrCode.expiresAt,
            dataUrl: result.qrCode.dataUrl,
          },
        },
        message: 'Order created successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  // ----------------------------------------------------------
  // GET /api/v1/orders/:orderId
  // Get a single order by ID
  // ----------------------------------------------------------
  getOrder = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = req.params;
      const userId = req.userId!;

      const order = await this.service.getOrder(orderId, userId);

      sendSuccess(res, 200, {
        data: {
          id: order.id,
          userId: order.user_id,
          items: order.items,
          totalAmount: order.total_amount,
          taxAmount: order.tax_amount,
          finalAmount: order.final_amount,
          orderStatus: order.order_status,
          paymentStatus: order.payment_status,
          qrStatus: order.qr_status,
          paymentType: order.payment_type,
          specialInstructions: order.special_instructions,
          timeline: {
            createdAt: order.created_at,
            confirmedAt: order.confirmed_at,
            scannedAt: order.scanned_at,
            servedAt: order.served_at,
            completedAt: order.completed_at,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ----------------------------------------------------------
  // GET /api/v1/orders
  // Get current user's orders (paginated)
  // ----------------------------------------------------------
  getUserOrders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const { status, limit, offset } = req.query as any;

      const result = await this.service.getUserOrders(userId, {
        status: status as string | undefined,
        limit: parseInt(limit) || 20,
        offset: parseInt(offset) || 0,
      });

      sendSuccess(res, 200, {
        data: {
          orders: result.orders,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  // ----------------------------------------------------------
  // PATCH /api/v1/orders/:orderId/cancel
  // Cancel an order
  // ----------------------------------------------------------
  cancelOrder = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orderId } = req.params;
      const userId = req.userId!;
      const { reason } = req.body;

      const result = await this.service.cancelOrder(orderId, userId, reason);

      sendSuccess(res, 200, {
        data: result,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/v1/orders/admin/all
   * Get all orders in the system (Admin only)
   */
  async getAllOrders(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { status, limit, offset } = req.query as any;

      const result = await this.service.getUserOrders(undefined, {
        status: status as string | undefined,
        limit: parseInt(limit) || 20,
        offset: parseInt(offset) || 0,
      });

      sendSuccess(res, 200, {
        data: {
          orders: result.orders,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ----------------------------------------------------------
  // PATCH /api/v1/orders/:orderId/status
  // Update order status (staff/admin)
  // ----------------------------------------------------------
  async updateOrderStatus(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { orderId } = req.params;
      const { status } = req.body;
      const userId = req.userId!;

      const updatedOrder = await this.service.updateOrderStatus(
        orderId,
        status as OrderStatus,
        userId
      );

      sendSuccess(res, 200, {
        data: updatedOrder,
        message: `Order status updated to ${status}`,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const orderController = new OrderController();
