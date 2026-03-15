# 🚀 BACKEND COMPLETION SPRINT GUIDE
## From 60% → 99% (Payment Mocked)

**Current Status**: Core order system ✅ + QR + Inventory complete  
**Target**: Full backend MVP (all endpoints) with mocked payments  
**Estimated Time**: 3-5 days (aggressive sprint)  
**Not Included**: Real Razorpay integration (you'll add later)

---

## 🎯 STRATEGIC OVERVIEW

### What We'll Complete
✅ Auth routes (login, registration, token refresh)  
✅ Menu API (retrieve items, categories, search)  
✅ User management (profile, roles, details)  
✅ Admin dashboard endpoints (reports, settings, user management)  
✅ Real-time setup (Socket.io with namespaces)  
✅ Mock payment integration (for testing order flow)  
✅ Notifications system (in-memory for dev)  
✅ Analytics endpoints  

### What We're SKIPPING (For Later)
❌ Real Razorpay payment gateway  
❌ Email service integration  
❌ SMS notifications  
❌ PDF export (basic JSON export instead)  
❌ AWS S3 storage (local uploads only)  

---

## 📋 IMPLEMENTATION ROADMAP (Priority Order)

### **SPRINT 1: AUTH & USER MANAGEMENT** (Day 1-2)
Target: Enable login flow from frontend

#### 1.1 **Create Auth Service** (`backend/src/services/auth.service.ts`)
```typescript
export class AuthService {
  // Methods to implement:
  async generateTokens(userId: string, role: UserRole): Promise<{accessToken, refreshToken}>
  async verifyToken(token: string): Promise<decoded>
  async refreshToken(refreshToken: string): Promise<{accessToken}>
  async validatePassword(plaintext: string, hash: string): Promise<boolean>
  async hashPassword(plaintext: string): Promise<string>
}
```
**Key Features**:
- JWT access tokens (1h expiry)
- Refresh tokens (7d expiry)
- bcryptjs password hashing
- Token payload signing

**Time Estimate**: 2-3 hours

---

#### 1.2 **Create User Service** (`backend/src/services/user.service.ts`)
```typescript
export class UserService {
  async createUser(firebaseUid: string, email: string, name: string): Promise<User>
  async getUserById(userId: string): Promise<User>
  async getUserByEmail(email: string): Promise<User>
  async updateUserProfile(userId: string, data: Partial<User>): Promise<User>
  async updateUserRole(userId: string, newRole: UserRole): Promise<User>
  async listUsers(role?: UserRole, limit?: number): Promise<User[]>
}
```
**Key Features**:
- User CRUD operations
- Role management
- Query optimization with caching

**Time Estimate**: 2-3 hours

---

#### 1.3 **Create Auth Routes** (`backend/src/routes/auth.routes.ts`)
**Endpoints to implement**:
```
POST   /api/v1/auth/register          - Create new user (Firebase ID)
POST   /api/v1/auth/login             - Login (get tokens)
POST   /api/v1/auth/refresh-token     - Refresh access token
POST   /api/v1/auth/logout            - Invalidate token
GET    /api/v1/auth/me                - Get current user profile
PATCH  /api/v1/auth/profile           - Update profile
```

**Validation**:
- Email format validation
- Password strength (if password-based)
- Firebase UID validation

**Time Estimate**: 2 hours

---

#### 1.4 **Create Auth Controller** (`backend/src/controllers/auth.controller.ts`)
```typescript
export class AuthController {
  register(req, res, next)  // POST /auth/register
  login(req, res, next)     // POST /auth/login
  refresh(req, res, next)   // POST /auth/refresh-token
  logout(req, res, next)    // POST /auth/logout
  getMe(req, res, next)     // GET /auth/me
  updateProfile(req, res, next) // PATCH /auth/profile
}
```

**Time Estimate**: 1.5 hours

---

### **SPRINT 2: MENU & CATEGORIES** (Day 2)
Target: Frontend can fetch menu

#### 2.1 **Create Menu Service** (`backend/src/services/menu.service.ts`)
```typescript
export class MenuService {
  async getMenu(categoryId?: string, options?: {limit, offset}): Promise<MenuItem[]>
  async getMenuCategories(): Promise<MenuCategory[]>
  async getMenuItemById(itemId: string): Promise<MenuItem>
  async searchItems(query: string): Promise<MenuItem[]>
  async createMenuItem(data: CreateMenuItemRequest): Promise<MenuItem> // Admin
  async updateMenuItem(itemId: string, data: Partial<MenuItem>): Promise<MenuItem> // Admin
  async deleteMenuItem(itemId: string): Promise<void> // Admin
}
```

**Key Features**:
- Filter by category
- Pagination support
- Search by name/description
- Cache menu data in Redis

**Time Estimate**: 2-3 hours

---

#### 2.2 **Create Menu Routes & Controller**
```
GET    /api/v1/menu              - Get all items (with category filter)
GET    /api/v1/menu/categories   - Get all categories
GET    /api/v1/menu/:id          - Get single item
GET    /api/v1/menu/search       - Search items
POST   /api/v1/menu              - Create item (Admin)
PATCH  /api/v1/menu/:id          - Update item (Admin)
DELETE /api/v1/menu/:id          - Delete item (Admin)
```

**Time Estimate**: 2 hours

---

### **SPRINT 3: PAYMENT MOCKING** (Day 2-3)
Target: Order flow can proceed without real Razorpay

#### 3.1 **Create Mock Payment Service** (`backend/src/services/payment.service.ts`)
```typescript
export class PaymentService {
  async initiatePayment(orderId: string, amount: number, type: PaymentType): Promise<{
    paymentId: string,
    status: 'PENDING',
    clientId?: string,  // For Razorpay integration later
  }>
  
  async confirmPayment(paymentId: string, metadata?: any): Promise<{
    status: 'SUCCESS' | 'FAILED',
    transactionId: string,
  }>
  
  async refundPayment(paymentId: string): Promise<{status: 'REFUNDED'}>
  
  // Mock implementations - just update DB
  async simulatePaymentSuccess(paymentId: string): Promise<void>
  async simulatePaymentFailure(paymentId: string, reason: string): Promise<void>
}
```

**Key Features**:
- Generate mock payment IDs (UUID)
- Track payment status in DB
- Support all payment types (UPI, CARD, CASH, WALLET, NET)
- Update order status on payment success
- Later: Replace with real Razorpay calls

**Time Estimate**: 2-3 hours

---

#### 3.2 **Payment Routes** (`backend/src/routes/payment.routes.ts`)
```
POST   /api/v1/payments/initiate           - Create payment
POST   /api/v1/payments/:paymentId/confirm - Confirm payment
POST   /api/v1/payments/:paymentId/refund  - Refund payment
GET    /api/v1/payments/:paymentId         - Get payment status

// Mock endpoints (remove in production)
POST   /api/v1/payments/mock/:id/success   - Force payment success
POST   /api/v1/payments/mock/:id/failure   - Force payment failure
```

**Time Estimate**: 1.5 hours

---

### **SPRINT 4: ADMIN DASHBOARD** (Day 3-4)
Target: Admin can see reports and manage system

#### 4.1 **Create Admin Service** (`backend/src/services/admin.service.ts`)
```typescript
export class AdminService {
  // Users
  async listAllUsers(filter?: {role, status}): Promise<User[]>
  async updateUserRole(userId: string, newRole: UserRole): Promise<User>
  async suspendUser(userId: string): Promise<User>
  
  // Menu
  async bulkUploadMenu(items: MenuItem[]): Promise<{created, updated}>
  
  // System
  async updateSystemSettings(settings: Partial<SystemSettings>): Promise<SystemSettings>
  async getSystemSettings(): Promise<SystemSettings>
  
  // Audit
  async getAuditLogs(filter?: {userId, action, dateRange}): Promise<AuditLog[]>
}
```

**Time Estimate**: 2-3 hours

---

#### 4.2 **Create Reporting Service** (`backend/src/services/reporting.service.ts`)
```typescript
export class ReportingService {
  async getDailyReport(date: Date): Promise<{
    totalOrders: number,
    totalRevenue: number,
    ordersByStatus: {},
    topItems: MenuItemWithCount[],
    paymentMethodBreakdown: {},
  }>
  
  async getDateRangeReport(startDate: Date, endDate: Date): Promise<Report>
  
  async getRevenueTracker(): Promise<{
    today: number,
    thisWeek: number,
    thisMonth: number,
    trend: 'up' | 'down',
  }>
  
  async getOrderMetrics(): Promise<{
    pending: number,
    confirmed: number,
    served: number,
    cancelled: number,
  }>
  
  async exportData(format: 'json' | 'csv'): Promise<string>
}
```

**Key Features**:
- Daily summaries
- Revenue tracking
- Order status breakdown
- Top items analysis
- JSON export (CSV can be added later)

**Time Estimate**: 3-4 hours

---

#### 4.3 **Admin Routes & Controller**
```
GET    /api/v1/admin/users              - List users
PATCH  /api/v1/admin/users/:id/role     - Update user role
POST   /api/v1/admin/users/:id/suspend  - Suspend user

GET    /api/v1/admin/reports/daily      - Daily report
GET    /api/v1/admin/reports/range      - Date range report
GET    /api/v1/admin/reports/revenue    - Revenue tracker
GET    /api/v1/admin/reports/orders     - Order metrics
GET    /api/v1/admin/reports/export     - Export data

PATCH  /api/v1/admin/settings           - Update system settings
GET    /api/v1/admin/audit-logs         - Audit logs
```

**Time Estimate**: 2 hours

---

### **SPRINT 5: REAL-TIME & NOTIFICATIONS** (Day 4-5)
Target: Frontend can subscribe to live updates

#### 5.1 **Setup Socket.io** (`backend/src/config/socket.ts`)
```typescript
export function initializeSocket(server: any) {
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL,
      methods: ['GET', 'POST'],
    },
  });

  // Namespaces
  io.of('/orders').on('connection', ...)      // Student: track my orders
  io.of('/admin').on('connection', ...)       // Admin: monitor system
  io.of('/cashier').on('connection', ...)     // Cashier: pending orders
}
```

**Namespaces**:
- `/orders` - Student-specific order updates
- `/admin` - System-wide updates
- `/cashier` - Cashier queue updates
- `/inventory` - Stock level changes

**Time Estimate**: 2-3 hours

---

#### 5.2 **Create Notification Service** (`backend/src/services/notification.service.ts`)
```typescript
export class NotificationService {
  async notifyOrderCreated(orderId: string, userId: string): Promise<void>
  async notifyOrderStatusChanged(orderId: string, newStatus: OrderStatus): Promise<void>
  async notifyPaymentSuccess(orderId: string): Promise<void>
  async notifyPaymentFailed(orderId: string, reason: string): Promise<void>
  async broadcastInventoryUpdate(itemId: string, newStock: number): Promise<void>
  async broadcastSystemMessage(message: string, level: 'info' | 'warning' | 'critical'): Promise<void>
}
```

**Implementation**:
- In-memory event emitter for dev
- Real Socket.io emissions
- Later: Add Redis pub/sub for production

**Time Estimate**: 2-3 hours

---

#### 5.3 **Socket.io Event Handlers**
```typescript
// Client subscribes to order updates
socket.on('subscribe:order', (orderId) => { /* join room */ })
socket.on('unsubscribe:order', (orderId) => { /* leave room */ })

// Server broadcasts
io.to(`order:${orderId}`).emit('order:status-changed', { newStatus })
io.to('admin').emit('order:created', { orderId, userId })
io.to('cashier').emit('inventory:low-stock', { itemId, currentStock })
```

**Time Estimate**: 2 hours

---

### **SPRINT 6: POLISH & TESTING** (Day 5)
Target: All endpoints working, tests passing

#### 6.1 **Add Missing Middleware**
- ✅ Rate limiting (express-rate-limit)
- ✅ Request size limits
- ✅ Pagination middleware
- ✅ Not found 404 handler

**Time Estimate**: 1 hour

---

#### 6.2 **Update Test Suite** (`backend/test-endpoints.js`)
Add new tests for:
- Auth endpoints (register, login, refresh)
- Menu endpoints (get items, categories)
- Admin endpoints (reports, settings)
- Payment mock endpoints
- Role-based access control

**Target**: 50+ total tests, all passing

**Time Estimate**: 2-3 hours

---

#### 6.3 **Documentation Updates**
- Update API README with all new endpoints
- Add Socket.io event documentation
- Update setup instructions
- Add mock payment usage guide

**Time Estimate**: 1-2 hours

---

## 📅 DAILY SPRINT BREAKDOWN

### **Day 1: Auth & Users**
```
Morning:   Auth Service + User Service          (8am-12pm)
Afternoon: Auth Routes + Auth Controller        (1pm-5pm)
Evening:   Test auth endpoints, debug           (5pm-7pm)
Target:    Login/register working ✅
```

### **Day 2: Menu + Payment Mock**
```
Morning:   Menu Service + Routes                (8am-12pm)
Afternoon: Payment Mock Service + Routes        (1pm-5pm)
Evening:   Integration testing                  (5pm-7pm)
Target:    Menu API + Mock payments working ✅
```

### **Day 3: Admin & Reporting**
```
Morning:   Admin Service + Reporting Service    (8am-12pm)
Afternoon: Admin Routes + Controller            (1pm-5pm)
Evening:   Test reports, aggregation queries    (5pm-7pm)
Target:    Admin dashboard endpoints ✅
```

### **Day 4: Real-time & Notifications**
```
Morning:   Socket.io setup + namespaces         (8am-12pm)
Afternoon: Notification Service + handlers      (1pm-5pm)
Evening:   Test real-time subscriptions         (5pm-7pm)
Target:    Live updates working ✅
```

### **Day 5: Polish & Testing**
```
Morning:   Rate limiting + missing middleware   (8am-12pm)
Afternoon: Update test suite                    (1pm-4pm)
Evening:   Final verification, documentation    (4pm-7pm)
Target:    Full system 99% complete ✅
```

---

## 🛠️ QUICK IMPLEMENTATION TIPS

### Tip 1: Copy-Paste Patterns
All services follow this structure:
```typescript
export class XyzService {
  constructor() { }

  async method1() { /* implement */ }
  async method2() { /* implement */ }

  // Export singleton
  export const xyzService = new XyzService();
}
```

All controllers follow this:
```typescript
export class XyzController {
  constructor(private service: XyzService) { }

  handler1 = async (req, res, next) => { }
  handler2 = async (req, res, next) => { }

  export const xyzController = new XyzController(xyzService);
}
```

### Tip 2: Database Queries
Use the existing pattern:
```typescript
const result = await query(
  `SELECT ... FROM ... WHERE id = $1`,
  [id]
);
```

For transactions:
```typescript
const client = await getClient();
await client.query('BEGIN');
try {
  // operations
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
}
```

### Tip 3: Error Handling
Use existing error classes:
```typescript
throw new NotFoundError('User not found');
throw new ValidationError('Invalid email');
throw new UnauthorizedError('Access denied');
throw new AppError(500, 'Database error', 'DB_ERROR');
```

### Tip 4: Reuse Validation
All Zod schemas already defined. Use/extend from `validation.ts`:
```typescript
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  firebaseUid: z.string().uuid(),
});
```

---

## 📊 TEST VERIFICATION CHECKLIST

After implementing each sprint, verify:

### Sprint 1 Done?
- [ ] POST /auth/register returns 201 + tokens
- [ ] POST /auth/login returns 200 + tokens
- [ ] POST /auth/refresh-token refreshes access token
- [ ] GET /auth/me returns current user
- [ ] Invalid credentials return 401

### Sprint 2 Done?
- [ ] GET /menu returns all items
- [ ] GET /menu?categoryId=xxx filters correctly
- [ ] GET /menu/categories returns all categories
- [ ] GET /menu/:id returns single item
- [ ] Caching works (2nd call faster)

### Sprint 3 Done?
- [ ] POST /payments/initiate creates payment
- [ ] POST /payments/:id/confirm updates status
- [ ] POST /payments/mock/:id/success simulates success
- [ ] Order status updates when payment succeeds

### Sprint 4 Done?
- [ ] GET /admin/reports/daily returns stats
- [ ] GET /admin/reports/revenue shows tracking
- [ ] GET /admin/users lists all users
- [ ] PATCH /admin/users/:id/role works

### Sprint 5 Done?
- [ ] Socket.io connects on localhost
- [ ] Subscribe to order room works
- [ ] Notifications emit correctly
- [ ] Frontend receives live updates

---

## 🎯 SUCCESS CRITERIA FOR 99%

At completion, you should have:

✅ **35+ API Endpoints** (vs. current 7)
✅ **All CRUD operations** (Create, Read, Update, Delete)
✅ **Authentication complete** (login, register, token refresh)
✅ **Authorization working** (student vs. cashier vs. admin)
✅ **Real-time events** (Socket.io namespaces)
✅ **Reports & Analytics** (daily, revenue, metrics)
✅ **Mock payments** (test payment flow without Razorpay)
✅ **50+ passing tests** (vs. current 25+)
✅ **Production-grade error handling**
✅ **Full documentation**
✅ **Zero TypeScript errors**
✅ **Database transactions working**

---

## ❌ EXPLICITLY NOT INCLUDED

These can be added later:
- ❌ Real Razorpay integration (you'll do)
- ❌ Email notifications (SendGrid)
- ❌ SMS alerts (Twilio)
- ❌ PDF exports (only JSON)
- ❌ AWS S3 uploads (local files only)
- ❌ Stripe/PayPal (only Razorpay stub)
- ❌ Kubernetes deployment (Docker only)
- ❌ GraphQL API (REST only)

---

## 🚀 START HERE

### Before You Begin:
1. Read this entire document
2. Create all file stubs (empty files with structure)
3. Start with Sprint 1 (Auth)
4. Test each sprint before moving to next
5. Update test-endpoints.js continuously

### Command to get started:
```bash
cd backend

# Create all service files
touch src/services/auth.service.ts
touch src/services/user.service.ts
touch src/services/menu.service.ts
touch src/services/payment.service.ts
touch src/services/admin.service.ts
touch src/services/reporting.service.ts
touch src/services/notification.service.ts

# Create route files
touch src/routes/auth.routes.ts
touch src/routes/menu.routes.ts
touch src/routes/payment.routes.ts
touch src/routes/admin.routes.ts
touch src/routes/socket.ts

# Create controller files
touch src/controllers/auth.controller.ts
touch src/controllers/menu.controller.ts
touch src/controllers/payment.controller.ts
touch src/controllers/admin.controller.ts

# Run tests
npm run dev  # Terminal 1
node test-endpoints.js  # Terminal 2
```

### Monitor as you implement:
```bash
# Keep these running:
npm run dev              # Backend server
node test-endpoints.js  # Test suite (run after each feature)
```

---

## 💡 ARCHITECTURE REFERENCE

### Current Backend Structure (Working)
```
✅ Order lifecycle (create → status → cancel)
✅ QR code security (encryption + signing)
✅ Inventory atomicity (row-level locking)
✅ Audit trail (all actions logged)
✅ Error handling (custom error classes)
✅ Middleware stack (auth, validation, logging)
```

### What You're Adding
```
→ Auth flow (register → login → tokens → refresh)
→ Menu system (categories, items, caching)
→ Payment mocking (for testing order flow)
→ Admin dashboard (reports, user management)
→ Real-time updates (Socket.io broadcast)
→ System notifications (in-memory events)
```

---

## 📞 QUICK REFERENCE

| Feature | File | Status |
|---------|------|--------|
| Auth Service | `services/auth.service.ts` | 📝 TODO |
| User Service | `services/user.service.ts` | 📝 TODO |
| Menu Service | `services/menu.service.ts` | 📝 TODO |
| Payment Service | `services/payment.service.ts` | 📝 TODO |
| Admin Service | `services/admin.service.ts` | 📝 TODO |
| Reporting Service | `services/reporting.service.ts` | 📝 TODO |
| Notification Service | `services/notification.service.ts` | 📝 TODO |
| Socket.io | `config/socket.ts` | 📝 TODO |
| Auth Routes | `routes/auth.routes.ts` | 📝 TODO |
| Menu Routes | `routes/menu.routes.ts` | 📝 TODO |
| Payment Routes | `routes/payment.routes.ts` | 📝 TODO |
| Admin Routes | `routes/admin.routes.ts` | 📝 TODO |
| Auth Controller | `controllers/auth.controller.ts` | 📝 TODO |
| Menu Controller | `controllers/menu.controller.ts` | 📝 TODO |
| Payment Controller | `controllers/payment.controller.ts` | 📝 TODO |
| Admin Controller | `controllers/admin.controller.ts` | 📝 TODO |

---

**🎉 YOU'VE GOT THIS!**  
Start with Day 1 Sprint 1, follow the pattern, test after each feature.  
In 5 days: Full backend MVP ready for frontend integration!

**Payment integration for later = Clean separation of concerns = Win! 🏆**
