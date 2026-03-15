import { Router } from 'express';
import { orderController } from '../controllers/order.controller';
import { authMiddleware, requireRole } from '../middleware/auth';
import {
  validateBody,
  validateQuery,
  createOrderSchema,
  getOrdersQuerySchema,
  cancelOrderSchema,
} from '../middleware/validation';

const router = Router();

/**
 * Order Routes
 * Per BACKEND_DEVELOPMENT_PROMPT.md API Specification Section 2
 *
 * POST   /orders                    - Create order (Student)
 * GET    /orders                    - Get my orders (Authenticated)
 * GET    /orders/:orderId           - Get single order (Authenticated)
 * PATCH  /orders/:orderId/cancel    - Cancel order (Student who created OR Admin)
 * PATCH  /orders/:orderId/status    - Update status (Cashier/Server/Admin)
 */

// All order routes require authentication
router.use(authMiddleware);

// Create order - Students only
router.post(
  '/',
  requireRole('student'),
  validateBody(createOrderSchema),
  orderController.createOrder
);

// Get current user's orders (paginated)
router.get(
  '/',
  validateQuery(getOrdersQuerySchema),
  orderController.getUserOrders
);

// Get single order by ID
router.get(
  '/:orderId',
  orderController.getOrder
);

// Cancel order - Student (own order) or Admin
router.patch(
  '/:orderId/cancel',
  validateBody(cancelOrderSchema),
  orderController.cancelOrder
);

// Update order status - Staff/Admin only
router.patch(
  '/:orderId/status',
  requireRole('cashier', 'server', 'admin'),
  orderController.updateOrderStatus
);

// Admin: Get all orders
router.get(
  '/admin/all',
  requireRole('admin'),
  orderController.getAllOrders.bind(orderController)
);

export default router;
