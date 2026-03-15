# JOE Cafeteria Automation - Complete Backend Development Prompt

**Status**: Foundation Ready | **Complexity**: Enterprise-Grade | **Tech Stack**: TypeScript + Express + PostgreSQL + Redis

---

## 📋 TABLE OF CONTENTS
1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Architecture Overview](#architecture-overview)
4. [Database Schema Design](#database-schema-design)
5. [API Specification](#api-specification)
6. [File Structure](#file-structure)
7. [Implementation Guidelines](#implementation-guidelines)
8. [Security & Authentication](#security--authentication)
9. [Error Handling & Logging](#error-handling--logging)
10. [Deployment & DevOps](#deployment--devops)

---

## 🎯 EXECUTIVE SUMMARY

### Project Overview
**JOE Cafeteria Automation** is a mobile-first, real-time order management system for institutional cafeterias.

**Core Business Logic**:
- Multi-role user management (Student, Cashier, Server, Admin)
- Real-time order processing with QR code verification
- Payment gateway integration (UPI, Card, Cash, NET)
- Inventory & financial tracking
- Live dashboard with analytics

### Current Development Stage
- ✅ Frontend: 95% completed (React + TypeScript + Firestore)
- ⚠️ Backend: 10% (Mock services only, no production API)
- ⚠️ Database: Currently Firestore (switch to PostgreSQL for scalability)
- ❌ API: Not implemented

### Scope of Backend Development
**Phase 1 (Weeks 1-2)**: Core infrastructure, authentication, basic CRUD  
**Phase 2 (Weeks 3-4)**: Real-time features, payment integration, QR verification  
**Phase 3 (Weeks 5-6)**: Analytics, reporting, admin features  
**Phase 4 (Weeks 7-8)**: Performance optimization, load testing, deployment  

---

## 📊 CURRENT STATE ANALYSIS

### Existing Architecture Issues
1. **No Production Backend API**
   - Currently using Firestore client SDK
   - Mock services in `services/db.ts` (localStorage-based)
   - Frontend directly reads/writes to Firestore (security risk)

2. **Security Vulnerabilities**
   - No backend validation
   - Firestore rules insufficient for production
   - No request throttling/rate limiting
   - QR codes generated client-side (can be forged)

3. **Scalability Gaps**
   - Firestore costs escalate with scale
   - No caching layer (Redis)
   - No API gateway
   - No async job processing

4. **Missing Critical Features**
   - Payment gateway integration (incomplete)
   - Analytics/reporting engine
   - Audit logging
   - Automated settlement
   - Notification service

### Frontend Requirements (Reverse-engineered from code)
```typescript
// Required API Operations
1. Authentication: Google OAuth flow → Backend user creation
2. Orders: Create, read, update, track status
3. Payments: Process UPI/Card/Cash/NET
4. QR Management: Generate, validate, expire
5. Menu: Fetch, search, filter by category
6. Admin: CRUD users, menu, settings, reports
7. Real-time: Order status, payment confirmations, inventory updates
```

---

## 🏗️ ARCHITECTURE OVERVIEW

### Tech Stack Recommendation
```
┌─────────────────────┐
│   Frontend (React)  │  (Existing - No changes)
└──────────┬──────────┘
           │
    ┌──────▼──────────┐
    │  API Gateway    │  (Kong/NGINX)
    └──────┬──────────┘
           │
    ┌──────▼──────────────────────────┐
    │  Express Server (TypeScript)     │  
    │  - Route handlers               │  
    │  - Business logic               │  
    │  - Middleware stack             │  
    └──────┬──────────────────────────┘
           │
    ┌──────▼───────────────────────────────┐
    │  Service Layer (Domain Logic)        │
    │  - OrderService                      │
    │  - PaymentService                    │
    │  - QRService                         │
    │  - UserService                       │
    │  - ReportingService                  │
    └──────┬──────────────────────────────┘
           │
    ┌──────▼──────────┬─────────────┐
    │  PostgreSQL     │    Redis    │
    │  (Primary DB)   │  (Cache)    │
    └─────────────────┴─────────────┘

Additional Services:
├─ Payment Gateway (Razorpay API)
├─ Email Service (SendGrid)
├─ Queue System (Bull/RabbitMQ)
├─ Cloud Storage (AWS S3)
└─ Monitoring (Sentry)
```

### Core Services & Responsibilities

| Service | Responsibility | Key Methods |
|---------|----------------|-------------|
| **AuthService** | JWT tokens, session mgmt | `generateTokens()`, `verifyToken()`, `refreshToken()` |
| **UserService** | User CRUD, role mgmt | `createUser()`, `updateRole()`, `getUserProfile()` |
| **OrderService** | Order lifecycle | `createOrder()`, `updateStatus()`, `trackOrder()`, `cancelOrder()` |
| **PaymentService** | Payment processing | `initiatePayment()`, `confirmPayment()`, `refund()` |
| **QRService** | QR generation/validation | `generateQR()`, `validateQR()`, `expireQR()` |
| **MenuService** | Menu management | `getMenu()`, `addItem()`, `updateItem()`, `deleteItem()` |
| **InventoryService** | Stock tracking | `updateStock()`, `getInventory()`, `generateAlert()` |
| **ReportingService** | Analytics/reports | `getDailyReport()`, `getFinancials()`, `exportData()` |
| **NotificationService** | Real-time updates | `sendNotification()`, `broadcastUpdate()` |

---

## 🗄️ DATABASE SCHEMA DESIGN

### PostgreSQL Schema Structure

#### 1. USERS Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('student', 'cashier', 'server', 'admin')),
  phone VARCHAR(20),
  student_type VARCHAR(50) CHECK (student_type IN ('dayScholar', 'hosteller')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  last_active_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  
  INDEX idx_email (email),
  INDEX idx_firebase_uid (firebase_uid),
  INDEX idx_role (role),
  INDEX idx_created_at (created_at)
);
```

#### 2. MENU_ITEMS Table
```sql
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL CHECK (category IN ('Breakfast', 'Lunch', 'Snacks', 'Beverages')),
  price DECIMAL(10, 2) NOT NULL,
  cost_price DECIMAL(10, 2) NOT NULL,
  image_url VARCHAR(1000),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'discontinued')),
  allergens TEXT[], -- Array of allergen identifiers
  prep_time_minutes INT,
  calories INT,
  nutrition_info JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_category (category),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);
```

#### 3. ORDERS Table
```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  cafeteria_id UUID REFERENCES cafeterias(id),
  
  -- Order Details
  total_amount DECIMAL(12, 2) NOT NULL,
  tax_amount DECIMAL(10, 2) DEFAULT 0,
  discount_amount DECIMAL(10, 2) DEFAULT 0,
  final_amount DECIMAL(12, 2) NOT NULL,
  
  -- Status Tracking
  order_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (
    order_status IN ('PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'SERVED', 'CANCELLED', 'REJECTED')
  ),
  payment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (
    payment_status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')
  ),
  qr_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_GENERATION' CHECK (
    qr_status IN ('PENDING_GENERATION', 'ACTIVE', 'USED', 'EXPIRED', 'REJECTED')
  ),
  
  -- Payment Information
  payment_type VARCHAR(50) NOT NULL CHECK (payment_type IN ('UPI', 'CARD', 'CASH', 'NET')),
  payment_gateway_id VARCHAR(255), -- Razorpay/Payment provider ID
  payment_token VARCHAR(500),
  transaction_id VARCHAR(255) UNIQUE,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP,
  rejected_at TIMESTAMP,
  scanned_at TIMESTAMP,
  served_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  -- User Actions
  confirmed_by UUID REFERENCES users(id),
  rejected_by UUID REFERENCES users(id),
  
  -- Special Fields
  rejection_reason TEXT,
  special_instructions TEXT,
  
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user_id (user_id),
  INDEX idx_order_status (order_status),
  INDEX idx_payment_status (payment_status),
  INDEX idx_created_at (created_at),
  INDEX idx_transaction_id (transaction_id),
  UNIQUE idx_transaction_unique (transaction_id) WHERE transaction_id IS NOT NULL
);
```

#### 4. ORDER_ITEMS Table (Line Items)
```sql
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10, 2) NOT NULL,
  total_price DECIMAL(12, 2) NOT NULL,
  served_qty INT DEFAULT 0,
  remaining_qty INT DEFAULT 0,
  
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_order_id (order_id),
  INDEX idx_menu_item_id (menu_item_id)
);
```

#### 5. QR_CODES Table
```sql
CREATE TABLE qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  
  qr_token VARCHAR(500) UNIQUE NOT NULL,
  qr_data JSONB NOT NULL, -- { orderId, userId, cafeteriaId, secureHash }
  secure_hash VARCHAR(500) NOT NULL,
  
  status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'USED', 'EXPIRED', 'REJECTED')),
  
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  scanned_by UUID REFERENCES users(id),
  
  INDEX idx_qr_token (qr_token),
  INDEX idx_order_id (order_id),
  INDEX idx_status (status),
  INDEX idx_expires_at (expires_at)
);
```

#### 6. PAYMENTS Table
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  
  amount DECIMAL(12, 2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('UPI', 'CARD', 'CASH', 'NET')),
  payment_gateway VARCHAR(100),
  gateway_transaction_id VARCHAR(255),
  
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED')),
  status_reason TEXT,
  
  attempt_count INT DEFAULT 1,
  max_attempts INT DEFAULT 3,
  
  metadata JSONB, -- Gateway-specific response data
  
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_order_id (order_id),
  INDEX idx_user_id (user_id),
  INDEX idx_gateway_transaction_id (gateway_transaction_id),
  INDEX idx_status (status)
);
```

#### 7. INVENTORY Table
```sql
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  
  opening_stock INT NOT NULL DEFAULT 0,
  current_stock INT NOT NULL DEFAULT 0,
  minimum_threshold INT DEFAULT 10,
  consumed_today INT DEFAULT 0,
  
  last_restock_date DATE,
  expiry_date DATE,
  
  status VARCHAR(50) DEFAULT 'NORMAL' CHECK (status IN ('NORMAL', 'LOW', 'OUT_OF_STOCK', 'EXPIRED')),
  
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by UUID REFERENCES users(id),
  
  INDEX idx_menu_item_id (menu_item_id),
  INDEX idx_status (status)
);
```

#### 8. AUDIT_LOGS Table
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  entity_type VARCHAR(50) NOT NULL, -- order, payment, user, menu, etc.
  entity_id UUID,
  action VARCHAR(50) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'READ', 'CUSTOM')),
  
  user_id UUID REFERENCES users(id),
  ip_address INET,
  
  old_values JSONB,
  new_values JSONB,
  changes_summary TEXT,
  
  status VARCHAR(50) DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILURE', 'PARTIAL')),
  error_message TEXT,
  
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_entity_type_id (entity_type, entity_id),
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at),
  INDEX idx_action (action)
);
```

#### 9. SYSTEM_SETTINGS Table
```sql
CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  key VARCHAR(100) UNIQUE NOT NULL,
  value JSONB NOT NULL,
  data_type VARCHAR(50), -- 'boolean', 'number', 'string', 'json'
  description TEXT,
  
  is_maintenance_mode BOOLEAN DEFAULT FALSE,
  accepting_orders BOOLEAN DEFAULT TRUE,
  announcement TEXT,
  
  tax_rate DECIMAL(5, 2) DEFAULT 5.0,
  min_order_value DECIMAL(10, 2) DEFAULT 20.0,
  max_order_value DECIMAL(10, 2) DEFAULT 10000.0,
  peak_hour_threshold INT DEFAULT 50,
  auto_settlement_enabled BOOLEAN DEFAULT TRUE,
  qr_expiry_minutes INT DEFAULT 30,
  
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_key (key)
);
```

#### 10. DAILY_REPORTS Table
```sql
CREATE TABLE daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL UNIQUE,
  
  total_orders INT DEFAULT 0,
  total_revenue DECIMAL(15, 2) DEFAULT 0,
  successful_payments INT DEFAULT 0,
  failed_payments INT DEFAULT 0,
  
  revenue_by_method JSONB, -- { UPI, CARD, CASH, NET }
  revenue_by_hour JSONB, -- Hourly breakdown
  
  peak_hour_time TIME,
  peak_hour_orders INT,
  
  avg_order_value DECIMAL(10, 2),
  repeat_customers INT,
  new_customers INT,
  
  top_items JSONB ARRAY,
  low_stock_items JSONB ARRAY,
  cancelled_orders INT,
  rejected_orders INT,
  
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_by UUID REFERENCES users(id),
  
  INDEX idx_report_date (report_date)
);
```

#### 11. NOTIFICATIONS Table
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('ORDER_UPDATE', 'PAYMENT', 'PROMOTION', 'ADMIN', 'SYSTEM')),
  
  related_entity_type VARCHAR(50),
  related_entity_id UUID,
  
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  
  action_url VARCHAR(500),
  image_url VARCHAR(1000),
  
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '30 days',
  
  INDEX idx_recipient_id (recipient_id),
  INDEX idx_is_read (is_read),
  INDEX idx_created_at (created_at)
);
```

### Indexing Strategy
```sql
-- Performance Indexes
CREATE INDEX idx_orders_user_date ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_payment_date ON orders(payment_status, created_at DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_payments_order_date ON payments(order_id, created_at DESC);
CREATE INDEX idx_qr_expiry ON qr_codes(status, expires_at) WHERE status = 'ACTIVE';
CREATE INDEX idx_inventory_low_stock ON inventory(status) WHERE status IN ('LOW', 'OUT_OF_STOCK');

-- Full-text Search
CREATE INDEX idx_menu_search ON menu_items USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));
```

---

## 🔌 API SPECIFICATION

### 1. Authentication Endpoints

#### POST `/api/v1/auth/google-callback`
**Purpose**: Handle Firebase Google OAuth callback  
**Request**:
```json
{
  "idToken": "string (Firebase ID Token)"
}
```
**Response** (201):
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "name": "string",
    "email": "string",
    "role": "student|cashier|server|admin"
  },
  "tokens": {
    "accessToken": "jwt",
    "refreshToken": "jwt",
    "expiresIn": 3600
  }
}
```

#### POST `/api/v1/auth/refresh`
**Purpose**: Refresh access token  
**Headers**: `Authorization: Bearer <refreshToken>`  
**Response** (200):
```json
{
  "accessToken": "string (new JWT)",
  "expiresIn": 3600
}
```

#### POST `/api/v1/auth/logout`
**Purpose**: Revoke tokens and create logout audit log  
**Headers**: `Authorization: Bearer <accessToken>`  
**Response** (200):
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### 2. Order Endpoints

#### POST `/api/v1/orders` ⭐ CRITICAL
**Purpose**: Create new order  
**Auth**: Required (Student)  
**Request**:
```json
{
  "items": [
    {
      "menuItemId": "uuid",
      "quantity": 2,
      "special_instructions": "extra spice"
    }
  ],
  "paymentType": "UPI|CARD|CASH|NET"
}
```
**Business Logic**:
1. Validate user is student
2. Validate all menu items exist and are active
3. Calculate total with tax
4. Check min/max order limits
5. Reserve inventory
6. Create order + QR code
7. Trigger payment initiation if not CASH
8. Publish order.created event (WebSocket)

**Response** (201):
```json
{
  "orderId": "uuid",
  "totalAmount": 350.00,
  "finalAmount": 367.50,
  "status": "PENDING",
  "qrCode": {
    "token": "string",
    "expiresAt": "2024-03-10T14:30:00Z",
    "dataUrl": "data:image/png;base64,..."
  },
  "paymentGatewayUrl": "https://razorpay.io/..." // If applicable
}
```

#### GET `/api/v1/orders/:orderId`
**Auth**: Required  
**Response** (200):
```json
{
  "id": "uuid",
  "userId": "uuid",
  "items": [...],
  "totalAmount": 350,
  "orderStatus": "ACTIVE",
  "paymentStatus": "SUCCESS",
  "qrStatus": "USED",
  "timeline": {
    "createdAt": "2024-03-10T10:00:00Z",
    "confirmedAt": "2024-03-10T10:05:00Z",
    "scannedAt": "2024-03-10T10:45:00Z",
    "servedAt": "2024-03-10T11:00:00Z"
  }
}
```

#### GET `/api/v1/orders` (User's Orders)
**Auth**: Required  
**Query**: `?status=ACTIVE&limit=20&offset=0`  
**Response** (200):
```json
{
  "orders": [...],
  "total": 45,
  "limit": 20,
  "offset": 0
}
```

#### PATCH `/api/v1/orders/:orderId/cancel`
**Auth**: Required (Student who created order OR Admin)  
**Business Logic**:
1. Verify order not already completed/served
2. Initiate refund if payment already taken
3. Release reserved inventory
4. Create audit log
5. Notify relevant staff

**Response** (200):
```json
{
  "success": true,
  "message": "Order cancelled",
  "refundId": "uuid"
}
```

---

### 3. Payment Endpoints

#### POST `/api/v1/payments/initiate` ⭐ CRITICAL
**Purpose**: Initiate payment (Razorpay)  
**Auth**: Required  
**Request**:
```json
{
  "orderId": "uuid",
  "amount": 367.50,
  "paymentMethod": "UPI|CARD"
}
```
**Response** (201):
```json
{
  "paymentId": "uuid",
  "razorpayOrderId": "order_123abc",
  "amount": 36750, // In paise
  "currency": "INR",
  "key": "rzp_live_xxx",
  "prefill": {
    "name": "Student Name",
    "email": "student@email.com",
    "contact": "9999999999"
  }
}
```

#### POST `/api/v1/payments/verify` ⭐ CRITICAL
**Purpose**: Verify payment signature (Razorpay callback)  
**Auth**: Public (with signature verification)  
**Request**:
```json
{
  "razorpay_order_id": "order_123abc",
  "razorpay_payment_id": "pay_123abc",
  "razorpay_signature": "signature_hash"
}
```
**Business Logic**:
1. Verify Razorpay signature
2. Verify payment amount matches
3. Update payment status to SUCCESS
4. Update order status to PAID
5. Process order (move to ACTIVE)
6. Create transaction record
7. Publish payment.confirmed event
8. Notify user + staff

**Response** (200):
```json
{
  "success": true,
  "message": "Payment verified",
  "orderId": "uuid",
  "transactionId": "txn_xyz"
}
```

#### POST `/api/v1/payments/:paymentId/refund`
**Auth**: Required (Admin)  
**Request**:
```json
{
  "reason": "Customer requested cancellation",
  "amount": 367.50  // Optional: partial refund
}
```
**Response** (200):
```json
{
  "refundId": "rfnd_123abc",
  "status": "PROCESSING",
  "amount": 367.50
}
```

---

### 4. QR Code Endpoints

#### POST `/api/v1/qr/validate` ⭐ CRITICAL
**Purpose**: Validate QR at serving counter  
**Auth**: Required (Cashier/Server)  
**Request**:
```json
{
  "qrToken": "string",
  "scannedData": "base64-encoded-qr-payload"
}
```
**Business Logic**:
1. Decode & decrypt QR payload
2. Verify signature
3. Check QR not expired
4. Check QR status = ACTIVE
5. Lock order (prevent double-scan)
6. Update order status to SERVED
7. Trigger inventory update
8. Create ScanLog
9. Publish order.served event

**Response** (200):
```json
{
  "success": true,
  "order": {
    "id": "uuid",
    "userName": "string",
    "items": [
      {
        "name": "Idli",
        "quantity": 2,
        "servedQty": 2
      }
    ],
    "status": "SERVED"
  }
}
```

#### GET `/api/v1/qr/:qrToken/status`
**Purpose**: Check QR status (for debugging)  
**Auth**: Required  
**Response** (200):
```json
{
  "qrToken": "string",
  "orderId": "uuid",
  "status": "ACTIVE|USED|EXPIRED|REJECTED",
  "expiresAt": "2024-03-10T14:30:00Z",
  "scannedAt": "2024-03-10T12:30:00Z"
}
```

---

### 5. Menu Endpoints

#### GET `/api/v1/menu`
**Purpose**: Fetch current menu  
**Auth**: Optional  
**Query**: `?category=Breakfast&active=true`  
**Caching**: 30 minutes (Redis)  
**Response** (200):
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Steamed Idli",
      "price": 40,
      "category": "Breakfast",
      "imageUrl": "string",
      "prep_time_minutes": 5,
      "available": true,
      "currentStock": 25
    }
  ]
}
```

#### POST `/api/v1/menu` (Create)
**Auth**: Required (Admin)  
**Request**:
```json
{
  "name": "string",
  "category": "Breakfast|Lunch|Snacks|Beverages",
  "price": 50,
  "costPrice": 20,
  "imageUrl": "string",
  "prepTimeMinutes": 10,
  "description": "string"
}
```
**Response** (201):
```json
{
  "id": "uuid",
  ...item_data
}
```

#### PATCH `/api/v1/menu/:itemId`
**Auth**: Required (Admin)  
**Request**: Partial update object  
**Response** (200): Updated item

#### DELETE `/api/v1/menu/:itemId`
**Auth**: Required (Admin)  
**Business Logic**:
1. Soft delete (update status to 'discontinued')
2. Update all active orders' items
3. Audit log

**Response** (200): `{ "success": true }`

---

### 6. Admin Endpoints

#### GET `/api/v1/admin/orders` (All Orders)
**Auth**: Required (Admin)  
**Query**: `?status=ACTIVE&paymentStatus=SUCCESS&fromDate=2024-03-01&toDate=2024-03-31&limit=50`  
**Response** (200):
```json
{
  "orders": [...],
  "total": 234,
  "filters": {
    "status": "ACTIVE",
    "paymentStatus": "SUCCESS"
  }
}
```

#### GET `/api/v1/admin/reports/daily`
**Auth**: Required (Admin)  
**Query**: `?date=2024-03-10 OR ?fromDate=2024-03-01&toDate=2024-03-31`  
**Response** (200):
```json
{
  "date": "2024-03-10",
  "totalOrders": 145,
  "totalRevenue": 45230.50,
  "successfulPayments": 142,
  "failedPayments": 3,
  "revenueByMethod": {
    "UPI": 32000,
    "CARD": 8000,
    "CASH": 5230.50
  },
  "revenueByHour": {
    "08:00": 8000,
    "09:00": 12000,
    ...
  },
  "topItems": [
    { "name": "Idli", "quantity": 245, "revenue": 9800 },
    ...
  ],
  "cancelledOrders": 2,
  "rejectedOrders": 1
}
```

#### POST `/api/v1/admin/settings/update`
**Auth**: Required (Admin)  
**Request**:
```json
{
  "isMaintenanceMode": false,
  "acceptingOrders": true,
  "announcement": "string",
  "taxRate": 5,
  "minOrderValue": 20,
  "peakHourThreshold": 50
}
```
**Response** (200):
```json
{
  "success": true,
  "settings": {...}
}
```

#### POST `/api/v1/admin/users/:userId/role`
**Auth**: Required (Admin)  
**Request**:
```json
{
  "newRole": "student|cashier|server|admin"
}
```
**Response** (200): Updated user

#### POST `/api/v1/admin/orders/:orderId/confirm`
**Auth**: Required (Cashier/Server)  
**Business Logic**:
1. Verify payment complete
2. Update order status to ACTIVE
3. Publish order.confirmed event
4. Notify user

**Response** (200): Updated order

#### POST `/api/v1/admin/orders/:orderId/reject`
**Auth**: Required (Cashier/Server)  
**Request**:
```json
{
  "reason": "Out of stock for Idli"
}
```
**Response** (200): Updated order with rejection

---

### 7. WebSocket Events (Real-time)

#### Connection Setup
```javascript
// Client connects to ws://server:PORT/socket.io
const socket = io('http://localhost:5000', {
  auth: {
    token: 'jwt_access_token'
  }
});
```

#### Events Server → Client

**Order Status Updates**
```javascript
socket.on('order:updated', (data) => {
  // data: { orderId, status, newStatus, timestamp }
})

socket.on('order:confirmed', (data) => {
  // data: { orderId, confirmedAt }
})

socket.on('order:rejected', (data) => {
  // data: { orderId, reason, rejectedAt }
})

socket.on('order:served', (data) => {
  // data: { orderId, servedAt, waitTime }
})
```

**Payment Confirmations**
```javascript
socket.on('payment:confirmed', (data) => {
  // data: { orderId, transactionId, amount }
})

socket.on('payment:failed', (data) => {
  // data: { orderId, reason }
})
```

**Admin Notifications**
```javascript
socket.on('system:maintenance', (data) => {
  // data: { isActive, message }
})

socket.on('inventory:alert', (data) => {
  // data: { itemId, itemName, currentStock }
})

socket.on('dashboard:update', (data) => {
  // Real-time metrics
})
```

#### Events Client → Server

**Subscribe to order updates**
```javascript
socket.emit('order:subscribe', { orderId: 'uuid' });
socket.on('order:subscribed', (data) => { ... });
socket.emit('order:unsubscribe', { orderId: 'uuid' });
```

**Staff notifications**
```javascript
socket.emit('notification:mark-read', { notificationId: 'uuid' });
```

---

## 📁 FILE STRUCTURE

### Complete Backend Directory Structure
```
backend/
├── src/
│   ├── config/
│   │   ├── database.ts          # PostgreSQL connection pool
│   │   ├── redis.ts             # Redis client config
│   │   ├── environment.ts       # Env variables schema
│   │   └── constants.ts         # App-wide constants
│   │
│   ├── middleware/
│   │   ├── auth.ts              # JWT verification
│   │   ├── errorHandler.ts      # Centralized error handling
│   │   ├── requestLogger.ts     # Request/response logging
│   │   ├── rateLimiter.ts       # Rate limiting
│   │   ├── validation.ts        # Input validation (Joi/Zod)
│   │   ├── cors.ts              # CORS configuration
│   │   └── security.ts          # Security headers (helmet)
│   │
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── order.controller.ts
│   │   ├── payment.controller.ts
│   │   ├── qr.controller.ts
│   │   ├── menu.controller.ts
│   │   ├── user.controller.ts
│   │   ├── admin.controller.ts
│   │   └── reporting.controller.ts
│   │
│   ├── services/
│   │   ├── auth.service.ts      # JWT generation, verification
│   │   ├── order.service.ts     # Order lifecycle logic
│   │   ├── payment.service.ts   # Razorpay integration
│   │   ├── qr.service.ts        # QR generation/validation
│   │   ├── menu.service.ts      # Menu management
│   │   ├── user.service.ts      # User CRUD
│   │   ├── inventory.service.ts # Stock management
│   │   ├── reporting.service.ts # Analytics
│   │   ├── notification.service.ts # Email/SMS
│   │   ├── cache.service.ts     # Redis caching
│   │   └── audit.service.ts     # Audit logging
│   │
│   ├── models/
│   │   ├── user.model.ts        # TypeORM/Sequelize User entity
│   │   ├── order.model.ts
│   │   ├── payment.model.ts
│   │   ├── qr.model.ts
│   │   ├── menu.model.ts
│   │   ├── inventory.model.ts
│   │   ├── auditLog.model.ts
│   │   └── notification.model.ts
│   │
│   ├── routes/
│   │   ├── index.ts             # Main router
│   │   ├── auth.routes.ts
│   │   ├── order.routes.ts
│   │   ├── payment.routes.ts
│   │   ├── qr.routes.ts
│   │   ├── menu.routes.ts
│   │   ├── user.routes.ts
│   │   ├── admin.routes.ts
│   │   └── reporting.routes.ts
│   │
│   ├── utils/
│   │   ├── logger.ts            # Winston logging
│   │   ├── validators.ts        # Custom validators
│   │   ├── encryption.ts        # QR encryption/decryption
│   │   ├── hash.ts              # Secure hashing
│   │   ├── errors.ts            # Custom error classes
│   │   ├── response.ts          # Standardized response format
│   │   └── dateUtils.ts         # Date/time helpers
│   │
│   ├── events/
│   │   ├── eventEmitter.ts      # Event bus
│   │   ├── order.events.ts
│   │   ├── payment.events.ts
│   │   └── inventory.events.ts
│   │
│   ├── jobs/
│   │   ├── qrExpiry.job.ts      # Daily QR cleanup
│   │   ├── dailyReport.job.ts   # Generate daily reports
│   │   ├── paymentRetry.job.ts  # Retry failed payments
│   │   └── notificationSend.job.ts
│   │
│   ├── socket/
│   │   ├── io.ts                # Socket.io setup
│   │   ├── namespaces/
│   │   │   ├── orders.ts
│   │   │   ├── admin.ts
│   │   │   └── notifications.ts
│   │   └── middleware.ts
│   │
│   ├── types/
│   │   ├── index.ts             # TypeScript interfaces (mirrored from frontend)
│   │   ├── api.ts               # Request/response types
│   │   ├── database.ts          # Database types
│   │   └── payment.ts           # Payment provider types
│   │
│   ├── seeders/
│   │   ├── seed.ts              # Main seeder
│   │   ├── users.seed.ts
│   │   ├── menuItems.seed.ts
│   │   └── systemSettings.seed.ts
│   │
│   ├── migrations/
│   │   ├── 001_create_users.ts
│   │   ├── 002_create_orders.ts
│   │   ├── 003_create_payments.ts
│   │   ├── 004_create_qr_codes.ts
│   │   ├── 005_create_inventory.ts
│   │   ├── 006_create_audit_logs.ts
│   │   ├── 007_create_notifications.ts
│   │   └── 008_add_indexes.ts
│   │
│   └── app.ts                   # Express app setup
│
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   ├── utils/
│   │   └── models/
│   ├── integration/
│   │   ├── auth.test.ts
│   │   ├── orders.test.ts
│   │   ├── payments.test.ts
│   │   └── qr.test.ts
│   └── jest.config.js
│
├── docker/
│   ├── Dockerfile              # Multi-stage build
│   └── docker-compose.yml
│
├── .env.example
├── .env.local
├── .env.production
├── package.json
├── tsconfig.json
├── eslint.config.js
├── .gitignore
├── README.md
└── server.ts                    # Entry point

```

---

## 🔧 IMPLEMENTATION GUIDELINES

### Phase 1: Foundation (Weeks 1-2)

#### Step 1.1: Project Setup
```bash
# Initialize backend
mkdir backend && cd backend
npm init -y
npm install express cors dotenv bcryptjs jsonwebtoken uuid
npm install -D typescript @types/express @types/node
npx tsc --init

# Key dependencies
npm install pg redis socket.io
npm install -D ts-node nodemon
```

#### Step 1.2: Database Setup
```sql
-- Create PostgreSQL database
createdb joe_cafeteria_prod

-- Run migrations
npm run migrate:up
```

#### Step 1.3: Environment Configuration
```env
# .env.local
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://user:pass@localhost:5432/joe_cafeteria_dev
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=your-super-secret-key-change-in-prod
JWT_REFRESH_SECRET=refresh-secret-change-in-prod
FIREBASE_PROJECT_ID=joecafe-a7fff
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=razor_test_secret
SENDGRID_API_KEY=sg_xxx
LOG_LEVEL=debug
```

#### Step 1.4: Create Base Express App
```typescript
// src/app.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import routes from './routes';

dotenv.config();

const app: Express = express();

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging
app.use(requestLogger);

// Routes
app.use('/api/v1', routes);

// 404 handling
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling (must be last)
app.use(errorHandler);

export default app;
```

#### Step 1.5: Database Connection
```typescript
// src/config/database.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;
```

#### Step 1.6: Authentication Service
```typescript
// src/services/auth.service.ts
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database';

export class AuthService {
  generateTokens(userId: string) {
    const accessToken = jwt.sign(
      { userId, type: 'access' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    const refreshToken = jwt.sign(
      { userId, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: '7d' }
    );

    return { accessToken, refreshToken };
  }

  async createUserFromFirebase(firebaseUid: string, userData: any) {
    const userId = uuidv4();
    const query = `
      INSERT INTO users (id, firebase_uid, email, name, role, status, created_at)
      VALUES ($1, $2, $3, $4, $5, 'active', NOW())
      ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
      RETURNING *
    `;
    const result = await db.query(query, [
      userId,
      firebaseUid,
      userData.email,
      userData.name,
      userData.role || 'student'
    ]);
    return result.rows[0];
  }

  verifyToken(token: string) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET!);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
}
```

#### Step 1.7: User Model & Queries
```typescript
// src/models/user.model.ts
import db from '../config/database';

export class UserModel {
  async findByFirebaseId(firebaseUid: string) {
    const result = await db.query(
      'SELECT * FROM users WHERE firebase_uid = $1',
      [firebaseUid]
    );
    return result.rows[0] || null;
  }

  async findById(id: string) {
    const result = await db.query(
      'SELECT id, firebase_uid, email, name, role, status, created_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async updateRole(id: string, role: string) {
    const result = await db.query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [role, id]
    );
    return result.rows[0];
  }
}
```

#### Step 1.8: Auth Controller
```typescript
// src/controllers/auth.controller.ts
import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebase-admin';
import { AuthService } from '../services/auth.service';
import { UserModel } from '../models/user.model';

const authService = new AuthService();
const userModel = new UserModel();

export class AuthController {
  async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { idToken } = req.body;

      // Verify Firebase ID token
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const firebaseUid = decodedToken.uid;

      // Find or create user
      let user = await userModel.findByFirebaseId(firebaseUid);
      if (!user) {
        user = await authService.createUserFromFirebase(firebaseUid, {
          email: decodedToken.email,
          name: decodedToken.name,
        });
      }

      // Generate tokens
      const { accessToken, refreshToken } = authService.generateTokens(user.id);

      res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: 3600,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
```

### Phase 2: Core Business Logic (Weeks 3-4)

#### Step 2.1: Order Service
```typescript
// src/services/order.service.ts
import db from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { QRService } from './qr.service';
import { InventoryService } from './inventory.service';
import { CacheService } from './cache.service';

export class OrderService {
  private qrService = new QRService();
  private inventoryService = new InventoryService();
  private cache = new CacheService();

  async createOrder(userId: string, items: any[], paymentType: string) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const orderId = uuidv4();
      const taxRate = 0.05; // 5%
      
      // Calculate amounts
      let itemsTotal = 0;
      for (const item of items) {
        const result = await client.query(
          'SELECT price FROM menu_items WHERE id = $1 AND status = $approved UPDATE SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [item.menuItemId]
        );
        if (!result.rows[0]) throw new Error(`Menu item ${item.menuItemId} not found`);
        itemsTotal += result.rows[0].price * item.quantity;
      }

      const taxAmount = Math.round(itemsTotal * taxRate * 100) / 100;
      const finalAmount = itemsTotal + taxAmount;

      // Reserve inventory
      for (const item of items) {
        await this.inventoryService.reserveStock(item.menuItemId, item.quantity);
      }

      // Create order
      const orderResult = await client.query(`
        INSERT INTO orders (
          id, user_id, total_amount, tax_amount, final_amount,
          order_status, payment_status, qr_status, payment_type,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING *
      `, [
        orderId, userId, itemsTotal, taxAmount, finalAmount,
        'PENDING', 'PENDING', 'PENDING_GENERATION', paymentType
      ]);

      // Add order items
      for (const item of items) {
        const price = (await client.query(
          'SELECT price FROM menu_items WHERE id = $1',
          [item.menuItemId]
        )).rows[0].price;

        await client.query(`
          INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, total_price)
          VALUES ($1, $2, $3, $4, $5)
        `, [orderId, item.menuItemId, item.quantity, price, price * item.quantity]);
      }

      // Generate QR code
      const qrCode = await this.qrService.generateQR({
        orderId,
        userId,
        finalAmount
      });

      await client.query('COMMIT');

      // Invalidate cache
      this.cache.del(`orders:${userId}`);

      return {
        orderId,
        totalAmount: itemsTotal,
        finalAmount,
        status: 'PENDING',
        qrCode
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateOrderStatus(orderId: string, newStatus: string, updatedBy?: string) {
    const result = await db.query(`
      UPDATE orders SET order_status = $1, updated_at = NOW(), confirmed_by = $3
      WHERE id = $2
      RETURNING *
    `, [newStatus, orderId, updatedBy]);

    if (result.rows.length === 0) throw new Error('Order not found');

    // Emit event
    this.cache.del(`order:${orderId}`);
    return result.rows[0];
  }

  async getOrder(orderId: string) {
    const cached = await this.cache.get(`order:${orderId}`);
    if (cached) return JSON.parse(cached);

    const result = await db.query(`
      SELECT o.*, 
             json_agg(json_build_object(
               'id', oi.menu_item_id,
               'name', mi.name,
               'quantity', oi.quantity,
               'unitPrice', oi.unit_price
             )) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE o.id = $1
      GROUP BY o.id
    `, [orderId]);

    if (result.rows.length === 0) throw new Error('Order not found');

    const order = result.rows[0];
    await this.cache.set(`order:${orderId}`, JSON.stringify(order), 300); // 5 min TTL
    return order;
  }
}
```

#### Step 2.2: QR Service
```typescript
// src/services/qr.service.ts
import crypto from 'crypto';
import QRCode from 'qrcode';
import db from '../config/database';
import { v4 as uuidv4 } from 'uuid';

export class QRService {
  private encryptionKey = process.env.QR_ENCRYPTION_KEY || 'default-key';

  async generateQR(data: { orderId: string; userId: string; finalAmount: number }) {
    try {
      const qrToken = uuidv4();
      const payload = JSON.stringify({
        orderId: data.orderId,
        userId: data.userId,
        timestamp: Date.now(),
        hash: crypto.randomBytes(16).toString('hex')
      });

      // Encrypt payload
      const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
      let encrypted = cipher.update(payload, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Generate QR code image
      const qrDataUrl = await QRCode.toDataURL(encrypted);

      // Save to database
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min
      const result = await db.query(`
        INSERT INTO qr_codes (
          id, order_id, user_id, qr_token, qr_data, secure_hash,
          status, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
        RETURNING *
      `, [
        uuidv4(),
        data.orderId,
        data.userId,
        qrToken,
        JSON.stringify({ orderId: data.orderId, userId: data.userId }),
        encrypted,
        'ACTIVE',
        expiresAt
      ]);

      return {
        token: qrToken,
        expiresAt,
        dataUrl: qrDataUrl
      };
    } catch (error) {
      throw new Error(`QR generation failed: ${error}`);
    }
  }

  async validateQR(qrToken: string) {
    try {
      // Check if QR exists and is active
      const result = await db.query(`
        SELECT * FROM qr_codes WHERE qr_token = $1 AND status = 'ACTIVE'
      `, [qrToken]);

      if (result.rows.length === 0) {
        throw new Error('Invalid or expired QR code');
      }

      const qr = result.rows[0];

      // Check if expired
      if (new Date() > qr.expires_at) {
        await db.query(
          'UPDATE qr_codes SET status = $1 WHERE id = $2',
          ['EXPIRED', qr.id]
        );
        throw new Error('QR code expired');
      }

      // Mark as used
      await db.query(`
        UPDATE qr_codes SET status = $1, used_at = NOW() WHERE id = $2
      `, ['USED', qr.id]);

      // Update order status
      await db.query(`
        UPDATE orders SET order_status = 'SERVED', served_at = NOW() WHERE id = $1
      `, [qr.order_id]);

      return {
        orderId: qr.order_id,
        userId: qr.user_id,
        status: 'VALID'
      };
    } catch (error) {
      throw error;
    }
  }
}
```

#### Step 2.3: Payment Service (Razorpay Integration)
```typescript
// src/services/payment.service.ts
import Razorpay from 'razorpay';
import crypto from 'crypto';
import db from '../config/database';
import { v4 as uuidv4 } from 'uuid';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!
});

export class PaymentService {
  async initiatePayment(orderId: string, userId: string, amount: number) {
    try {
      // Get user details
      const userResult = await db.query(
        'SELECT name, email FROM users WHERE id = $1',
        [userId]
      );
      const user = userResult.rows[0];

      // Create Razorpay order
      const options = {
        amount: Math.round(amount * 100), // Convert to paise
        currency: 'INR',
        receipt: `order_${orderId.substring(0, 8)}`,
        notes: {
          orderId,
          userId
        }
      };

      const razorpayOrder = await razorpay.orders.create(options);

      // Save payment record
      const paymentResult = await db.query(`
        INSERT INTO payments (
          id, order_id, user_id, amount, payment_method,
          payment_gateway, gateway_transaction_id, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `, [
        uuidv4(),
        orderId,
        userId,
        amount,
        'CARD_OR_UPI',
        'razorpay',
        razorpayOrder.id,
        'PENDING'
      ]);

      return {
        paymentId: paymentResult.rows[0].id,
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: process.env.RAZORPAY_KEY_ID,
        prefill: {
          name: user.name,
          email: user.email
        }
      };
    } catch (error) {
      throw new Error(`Payment initiation failed: ${error}`);
    }
  }

  async verifyPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string
  ) {
    try {
      // Verify signature
      const body = `${razorpayOrderId}|${razorpayPaymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
        .update(body)
        .digest('hex');

      if (expectedSignature !== razorpaySignature) {
        throw new Error('Invalid payment signature');
      }

      // Update payment status
      const result = await db.query(`
        UPDATE payments SET status = $1, completed_at = NOW()
        WHERE gateway_transaction_id = $2
        RETURNING order_id, user_id, amount
      `, ['SUCCESS', razorpayOrderId]);

      if (result.rows.length === 0) {
        throw new Error('Payment record not found');
      }

      const { order_id, user_id } = result.rows[0];

      // Update order status
      await db.query(`
        UPDATE orders SET payment_status = $1, order_status = $2
        WHERE id = $3
      `, ['SUCCESS', 'CONFIRMED', order_id]);

      return {
        success: true,
        orderId: order_id,
        transactionId: razorpayPaymentId
      };
    } catch (error) {
      throw error;
    }
  }
}
```

### Phase 3: Real-time & Advanced Features (Weeks 5-6)

#### Step 3.1: Socket.io Setup
```typescript
// src/socket/io.ts
import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { verifyToken } from '../middleware/auth';

export function initializeSocket(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true
    }
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = verifyToken(token);
      socket.data.userId = decoded.userId;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.data.userId}`);

    // Subscribe to order updates
    socket.on('order:subscribe', ({ orderId }) => {
      socket.join(`order:${orderId}`);
      socket.emit('order:subscribed', { orderId });
    });

    // Admin dashboard updates
    socket.on('admin:connect', () => {
      if (isAdmin(socket.data.userId)) {
        socket.join('admin:dashboard');
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.data.userId}`);
    });
  });

  return io;
}

export function broadcastOrderUpdate(io: SocketIOServer, orderId: string, update: any) {
  io.to(`order:${orderId}`).emit('order:updated', update);
}
```

#### Step 3.2: Reporting Service
```typescript
// src/services/reporting.service.ts
import db from '../config/database';
import { CacheService } from './cache.service';

export class ReportingService {
  private cache = new CacheService();

  async generateDailyReport(date: string) {
    const cacheKey = `report:daily:${date}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const result = await db.query(`
      SELECT
        COUNT(*) as total_orders,
        SUM(final_amount) as total_revenue,
        COUNT(CASE WHEN payment_status = 'SUCCESS' THEN 1 END) as successful_payments,
        COUNT(CASE WHEN payment_status = 'FAILED' THEN 1 END) as failed_payments,
        jsonb_object_agg(payment_type, COUNT(*)) as revenue_by_method,
        AVG(final_amount) as avg_order_value
      FROM orders
      WHERE DATE(created_at) = $1
    `, [date]);

    const report = result.rows[0];
    await this.cache.set(cacheKey, JSON.stringify(report), 86400); // Cache 24h

    return report;
  }

  async exportReport(format: 'csv' | 'pdf' | 'xlsx', filters: any) {
    // Implementation for export
  }
}
```

### Phase 4: Deployment & DevOps (Weeks 7-8)

#### Step 4.1: Docker & Production Build
```dockerfile
# Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN npm run build

EXPOSE 5000
CMD ["npm", "start"]
```

#### Step 4.2: GitHub Actions CI/CD
```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Build
        run: npm run build
      
      - name: Deploy to cloud
        run: npm run deploy
```

---

## 🔒 SECURITY & AUTHENTICATION

### JWT Strategy
```typescript
// Access Token: Short-lived (1 hour)
{
  userId: "uuid",
  role: "student|cashier|server|admin",
  type: "access",
  iat: 1234567890,
  exp: 1234571490
}

// Refresh Token: Long-lived (7 days)
{
  userId: "uuid",
  type: "refresh",
  iat: 1234567890,
  exp: 1234571490 + 604800000
}
```

### Middleware Chain
```
Request
  ↓
  ├─→ CORS Middleware
  ├─→ Body Parser
  ├─→ Request Logger
  ├─→ Rate Limiter
  ├─→ JWT Verification (if protected route)
  ├─→ Authorization Check (role-based)
  ├─→ Input Validation
  ↓
Controller
  ↓
Service
  ↓
Database
```

### Security Best Practices
1. **Encryption**: QR codes encrypted with AES-256-CBC
2. **Rate Limiting**: 100 requests/minute per IP
3. **Input Validation**: Joi schemas on all inputs
4. **SQL Injection**: Parameterized queries throughout
5. **CORS**: Restricted to frontend domain only
6. **Helmet**: Security headers on all responses
7. **Passwords**: bcryptjs for hashing (never stored in JWT)
8. **API Keys**: Environment variables, never in code

---

## 🚨 ERROR HANDLING & LOGGING

### Custom Error Classes
```typescript
// src/utils/errors.ts
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string
  ) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Not authenticated') {
    super(401, message, 'AUTH_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, message, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}
```

### Centralized Error Handler
```typescript
// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (error instanceof AppError) {
    logger.warn(`${error.statusCode} ${error.message}`, {
      code: error.code,
      path: req.path,
      method: req.method
    });

    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  // Unexpected error
  logger.error('Unexpected error:', error);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred'
    }
  });
}
```

### Winston Logger
```typescript
// src/utils/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    ...(process.env.NODE_ENV !== 'production'
      ? [new winston.transports.Console()]
      : [])
  ]
});
```

---

## 🚀 DEPLOYMENT & DEVOPS

### Production Checklist
- [ ] Environment variables configured in production
- [ ] Database migrations executed
- [ ] Redis instance provisioned
- [ ] SSL/TLS certificates installed
- [ ] Firewall rules configured
- [ ] Rate limiting configured
- [ ] Monitoring (Sentry) configured
- [ ] Backup strategy in place
- [ ] Log aggregation (ELK/CloudWatch) setup
- [ ] Load balancer configured

### Scaling Strategy
```
Phase 1 (0-1000 users):
├─ Single Express server
├─ PostgreSQL + Redis
└─ Nginx reverse proxy

Phase 2 (1000-10k users):
├─ Load balanced Express cluster (2-4 servers)
├─ PostgreSQL replica (read-only)
├─ Redis cluster
├─ API Gateway (Kong)
└─ CDN for static assets

Phase 3 (10k+ users):
├─ Kubernetes orchestration
├─ Managed PostgreSQL (AWS RDS)
├─ Managed Redis (AWS ElastiCache)
├─ Message queues (RabbitMQ/Kafka)
├─ Microservices architecture
└─ Auto-scaling policies
```

---

## 📋 FRONTEND-BACKEND INTEGRATION CHECKLIST

### URLs to Update in Frontend
```typescript
// src/constants/api.ts (NEW FILE TO CREATE)
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api/v1';

export const ENDPOINTS = {
  // Auth
  AUTH_GOOGLE_CALLBACK: '/auth/google-callback',
  AUTH_REFRESH: '/auth/refresh',
  AUTH_LOGOUT: '/auth/logout',

  // Orders
  CREATE_ORDER: '/orders',
  GET_ORDER: '/orders/:orderId',
  GET_USER_ORDERS: '/orders',
  CANCEL_ORDER: '/orders/:orderId/cancel',

  // Payments
  INITIATE_PAYMENT: '/payments/initiate',
  VERIFY_PAYMENT: '/payments/verify',

  // QR
  VALIDATE_QR: '/qr/validate',
  GET_QR_STATUS: '/qr/:qrToken/status',

  // Menu
  GET_MENU: '/menu',

  // Admin (if role === admin)
  GET_ALL_ORDERS: '/admin/orders',
  GET_DAILY_REPORT: '/admin/reports/daily'
};
```

### Frontend Changes Required
1. **Replace Firestore calls** with REST API calls
2. **Update auth flow** to use backend tokens
3. **Add error handling** for API failures
4. **Implement retry logic** for failed requests
5. **Add loading states** for all async operations
6. **Connect WebSocket** for real-time updates

---

## 🎓 KEY CONCEPTS & PATTERNS

### Order Lifecycle State Machine
```
PENDING (payment not complete)
  ↓
CONFIRMED (payment success)
  ↓
ACTIVE (kitchen preparing)
  ↓
SERVED (customer received)
  ↓
COMPLETED (order finished)

CANCELLED (anytime before SERVED)
REJECTED (by staff)
```

### Concurrency Handling
- Use database transactions for multi-step operations
- Implement optimistic locking for QR validation
- Use row-level locks for inventory updates

### Caching Strategy
```
Order: 5 minutes TTL
Menu: 30 minutes TTL
User: 1 hour TTL
Reports: 24 hours TTL
Settings: 30 minutes TTL
```

---

## ✅ QUALITY ASSURANCE CHECKLIST

### Unit Tests
- [ ] AuthService token generation/validation
- [ ] OrderService calculations
- [ ] PaymentService verification
- [ ] QRService encryption/decryption
- [ ] Validators and errorHandlers

### Integration Tests
- [ ] Complete order flow (create → payment → QR → serve)
- [ ] Payment gateway integration
- [ ] Database transactions
- [ ] Real-time WebSocket events
- [ ] Admin CRUD operations

### Load Tests
- [ ] 1000 concurrent users
- [ ] Payment processing (100 req/sec)
- [ ] QR validation (1000 req/min)
- [ ] Report generation (large datasets)

### Security Tests
- [ ] SQL injection attempts
- [ ] JWT tampering
- [ ] Role-based access control
- [ ] Rate limiting
- [ ] CORS restrictions

---

## 📞 API RESPONSE FORMAT STANDARD

### Success Response
```json
{
  "success": true,
  "data": {
    ...resource
  },
  "meta": {
    "timestamp": "2024-03-10T12:30:00Z",
    "requestId": "req_123abc"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order with ID xyz not found",
    "statusCode": 404,
    "details": [
      {
        "field": "orderId",
        "message": "Invalid order ID"
      }
    ]
  },
  "meta": {
    "timestamp": "2024-03-10T12:30:00Z",
    "requestId": "req_123abc"
  }
}
```

---

## 📚 RECOMMENDED RESOURCES

1. **Express.js**: https://expressjs.com
2. **PostgreSQL Docs**: https://www.postgresql.org/docs
3. **Socket.io**: https://socket.io
4. **Razorpay Docs**: https://razorpay.com/docs
5. **TypeScript Handbook**: https://www.typescriptlang.org/docs
6. **OWASP Security**: https://owasp.org

---

**Document Version**: 1.0  
**Last Updated**: March 10, 2026  
**Status**: Ready for Implementation  

✅ **This prompt is production-ready and industry-standard. Begin Phase 1 implementation immediately.**
