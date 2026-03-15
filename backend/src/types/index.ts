import { Request } from 'express';
import {
  OrderStatus,
  PaymentStatus,
  QRStatus,
  PaymentType,
  UserRole,
  MenuCategory,
} from '../config/constants';

// ============================================================
// User Types
// ============================================================

export interface User {
  id: string;
  firebase_uid: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
  student_type?: 'dayScholar' | 'hosteller';
  status: 'active' | 'inactive' | 'suspended';
  last_active_at?: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

/** Express request with authenticated user info attached. */
export interface AuthRequest extends Request {
  userId?: string;
  userRole?: UserRole;
}

// ============================================================
// Menu Types
// ============================================================

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  category: MenuCategory;
  price: number;
  cost_price: number;
  image_url?: string;
  status: 'active' | 'inactive' | 'discontinued';
  allergens?: string[];
  prep_time_minutes?: number;
  calories?: number;
  nutrition_info?: Record<string, any>;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

// ============================================================
// Order Types
// ============================================================

export interface Order {
  id: string;
  user_id: string;
  cafeteria_id?: string;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  final_amount: number;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  qr_status: QRStatus;
  payment_type: PaymentType;
  payment_gateway_id?: string;
  payment_token?: string;
  transaction_id?: string;
  special_instructions?: string;
  rejection_reason?: string;
  confirmed_by?: string;
  rejected_by?: string;
  created_at: Date;
  confirmed_at?: Date;
  rejected_at?: Date;
  scanned_at?: Date;
  served_at?: Date;
  completed_at?: Date;
  updated_at: Date;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  served_qty: number;
  remaining_qty: number;
  created_at: Date;
}

export interface OrderWithItems extends Order {
  items: Array<{
    id: string;
    menu_item_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    served_qty: number;
  }>;
}

/** Request body for POST /orders */
export interface CreateOrderRequest {
  items: Array<{
    menuItemId: string;
    quantity: number;
    special_instructions?: string;
  }>;
  paymentType: PaymentType;
}

/** Response for POST /orders */
export interface CreateOrderResponse {
  orderId: string;
  totalAmount: number;
  taxAmount: number;
  finalAmount: number;
  status: OrderStatus;
  qrCode: {
    token: string;
    expiresAt: Date;
    dataUrl: string;
  };
  paymentGatewayUrl?: string;
}

// ============================================================
// QR Code Types
// ============================================================

export interface QRCode {
  id: string;
  order_id: string;
  user_id: string;
  qr_token: string;
  qr_data: Record<string, any>;
  secure_hash: string;
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REJECTED';
  created_at: Date;
  expires_at: Date;
  used_at?: Date;
  scanned_by?: string;
}

export interface QRGenerationResult {
  token: string;
  expiresAt: Date;
  dataUrl: string;
}

// ============================================================
// Payment Types
// ============================================================

export interface Payment {
  id: string;
  order_id: string;
  user_id: string;
  amount: number;
  payment_method: PaymentType;
  payment_gateway?: string;
  gateway_transaction_id?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  status_reason?: string;
  attempt_count: number;
  max_attempts: number;
  metadata?: Record<string, any>;
  created_at: Date;
  completed_at?: Date;
  updated_at: Date;
}

// ============================================================
// Inventory Types
// ============================================================

export interface Inventory {
  id: string;
  menu_item_id: string;
  opening_stock: number;
  current_stock: number;
  minimum_threshold: number;
  consumed_today: number;
  last_restock_date?: Date;
  expiry_date?: Date;
  status: 'NORMAL' | 'LOW' | 'OUT_OF_STOCK' | 'EXPIRED';
  updated_at: Date;
  updated_by?: string;
}

// ============================================================
// Audit Log Types
// ============================================================

export interface AuditLog {
  id: string;
  entity_type: string;
  entity_id?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'READ' | 'CUSTOM';
  user_id?: string;
  ip_address?: string;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  changes_summary?: string;
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  error_message?: string;
  created_at: Date;
}

// ============================================================
// Pagination Types
// ============================================================

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================
// System Settings Types
// ============================================================

export interface SystemSettings {
  tax_rate: number;
  min_order_value: number;
  max_order_value: number;
  qr_expiry_minutes: number;
  is_maintenance_mode: boolean;
  accepting_orders: boolean;
  announcement?: string;
  peak_hour_threshold: number;
  auto_settlement_enabled: boolean;
}
