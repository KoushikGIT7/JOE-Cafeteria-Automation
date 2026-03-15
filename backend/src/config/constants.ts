// ============================================================
// Application-wide Constants
// ============================================================

/** Valid order status transitions */
export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'ACTIVE',
  'COMPLETED',
  'SERVED',
  'CANCELLED',
  'REJECTED',
] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

/** Valid payment statuses */
export const PAYMENT_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

/** Valid QR statuses */
export const QR_STATUSES = ['PENDING_GENERATION', 'ACTIVE', 'USED', 'EXPIRED', 'REJECTED'] as const;
export type QRStatus = typeof QR_STATUSES[number];

/** Valid payment types */
export const PAYMENT_TYPES = ['UPI', 'CARD', 'CASH', 'NET'] as const;
export type PaymentType = typeof PAYMENT_TYPES[number];

/** Valid user roles */
export const USER_ROLES = ['student', 'cashier', 'server', 'admin'] as const;
export type UserRole = typeof USER_ROLES[number];

/** Menu categories */
export const MENU_CATEGORIES = ['Breakfast', 'Lunch', 'Snacks', 'Beverages'] as const;
export type MenuCategory = typeof MENU_CATEGORIES[number];

/** Default system settings */
export const DEFAULTS = {
  TAX_RATE: 0.05, // 5%
  MIN_ORDER_VALUE: 20.0,
  MAX_ORDER_VALUE: 10000.0,
  QR_EXPIRY_MINUTES: 30,
  PEAK_HOUR_THRESHOLD: 50,
  CACHE_TTL: {
    ORDER: 300,        // 5 minutes
    MENU: 1800,        // 30 minutes
    USER: 3600,        // 1 hour
    REPORT: 86400,     // 24 hours
    SETTINGS: 1800,    // 30 minutes
  },
} as const;

/** Allowed order status transitions */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'REJECTED'],
  CONFIRMED: ['ACTIVE', 'CANCELLED', 'REJECTED'],
  ACTIVE: ['SERVED', 'COMPLETED', 'CANCELLED'],
  SERVED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

/** API versioning */
export const API_PREFIX = '/api/v1';
