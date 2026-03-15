# JOE Cafeteria — Production Backend Optimization Blueprint

**Audience:** Senior distributed systems / Firebase / scalable backend  
**Scale:** 5,000–10,000 students/day; 600–1,500 concurrent at peak  
**Goal:** Production-grade, fault-tolerant, cost-efficient Firestore + Cloud Functions architecture

---

## High-Level Architecture Diagram (Text)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                         │
│  React (Student / Cashier / Server / Admin) — Firebase Auth, minimal direct writes │
└───────────────────────────────┬───────────────────────────────────────────────────┘
                                │
                                │ HTTPS / WebSocket (optional)
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         FIREBASE LAYER                                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │ Firebase Auth   │  │ Cloud Functions  │  │ Cloud Firestore                 │   │
│  │ (Google/Email)  │  │ (Callable +      │  │ • orders (sharded by date/hour) │   │
│  │                 │  │  Triggers)       │  │ • menu, users                   │   │
│  └────────┬────────┘  └────────┬────────┘  │ • inventory_shards/{itemId}/     │   │
│           │                    │           │   shard_{0..N}                   │   │
│           │                    │           │ • serveLogs, scanLogs            │   │
│           │                    │           │ • analytics_aggregates (daily)   │   │
│           │                    └───────────┼─────────────────────────────────┘   │
│           │                                │                                      │
│           └────────────────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                │
                                │ (Optional) Pub/Sub / scheduled
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  OBSERVABILITY                                                                   │
│  Cloud Logging • Cloud Monitoring • Custom metrics • Fraud/alerting              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Data flow (target state):**
- **Create order:** Client → Callable `createOrder` → Firestore transaction (order + inventory check).
- **Confirm payment / validate QR / serve item:** Client → Callable → Firestore transaction (no client writes to orders/inventory).
- **Real-time:** Client subscribes only to **specific order doc** or **paginated lists** (no unbounded collection listeners).
- **Menu / settings:** Client reads with cache; writes only via Admin or Callable.

---

## 1. Firestore Data Model (Optimized for Scale)

### 1.1 Design Principles

| Principle | Application |
|-----------|-------------|
| **Avoid hotspot documents** | Do not store all inventory in one doc per item; use sharded counters. |
| **Segment by time/partition** | Orders in date-based or hour-based collections to spread writes. |
| **Small, focused documents** | One order per doc; logs as append-only; aggregates in separate docs. |
| **Denormalize for read paths** | Order doc contains enough for list/detail; avoid joins. |
| **Limit document size** | Keep orders under 1 MiB; move large blobs to Storage + reference. |

### 1.2 Collections and Structures

#### `users/{uid}` (unchanged conceptually; tighten fields)

```text
{
  uid: string,
  email: string,
  name: string,
  role: "student" | "cashier" | "server" | "admin",
  studentType?: "dayScholar" | "hosteller",
  active: boolean,
  createdAt: Timestamp,
  lastActive: Timestamp
}
```

- **Why:** Single doc per user; read by uid. No hotspot; profile read once per session and cached client-side.

---

#### `menu/{itemId}`

```text
{
  id: string,
  name: string,
  price: number,
  costPrice: number,
  category: string,
  imageUrl: string,
  active: boolean,
  available: boolean,        // derived from inventory in real-time or cached
  sortOrder?: number,
  updatedAt: Timestamp
}
```

- **Why:** Read-heavy; one doc per item. `available` can be updated by Cloud Function after inventory aggregation or left to client to interpret from inventory API.

---

#### `orders/{orderId}` — **Critical: avoid single collection hotspot**

**Option A — Date-partitioned subcollections (recommended for 10k+ orders/day):**

- Main path: `orders_by_date/{YYYY-MM-DD}/orders/{orderId}`  
- Order ID format: `order_<date>_<random>` or `order_<timestamp>_<shortId>` so date is derivable.
- **Why:** Writes spread across many date docs; no single collection with millions of docs and one index.

**Option B — Single collection with strong indexing (current, acceptable up to ~5–10k orders/day):**

- Keep `orders/{orderId}`; rely on composite indexes and pagination (see Query section).

**Document shape (same for A or B):**

```text
{
  orderId: string,
  userId: string,
  userName: string,
  items: Array<{
    id: string,
    name: string,
    price: number,
    quantity: number,
    servedQty: number,
    remainingQty: number,
    costPrice?: number,
    category?: string,
    imageUrl?: string
  }>,
  totalAmount: number,
  paymentType: "CASH" | "ONLINE",
  paymentStatus: "PENDING" | "SUCCESS" | "REJECTED" | "FAILED",
  orderStatus: "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED",
  qrStatus: "PENDING_PAYMENT" | "ACTIVE" | "USED" | "EXPIRED" | "REJECTED",
  qr?: { token: string, status: string, createdAt: Timestamp },
  cafeteriaId: string,
  createdAt: Timestamp,
  scannedAt?: Timestamp,
  servedAt?: Timestamp,
  confirmedBy?: string,
  confirmedAt?: Timestamp,
  rejectedBy?: string,
  rejectedAt?: Timestamp,
  updatedAt: Timestamp
}
```

- **Why:** Single doc per order; all list/detail reads from this; no joins. `updatedAt` for optimistic locking or cache invalidation.

---

#### `inventory_shards/{itemId}/shards/shard_{0..N}` — Distributed counters

See Section 2. Shard count N (e.g. 5–20) chosen so expected writes per shard stay under ~1/sec sustained.

---

#### `serveLogs/{logId}` (append-only)

```text
{
  orderId: string,
  itemId: string,
  itemName: string,
  quantityServed: number,
  servedBy: string,
  servedAt: Timestamp,
  cafeteriaId?: string
}
```

- **Why:** Write-once logs; no updates. Query by time range + optional orderId/itemId for audits.

---

#### `scanLogs/{logId}` (append-only)

```text
{
  orderId: string,
  userId: string,
  userName: string,
  scannedBy: string,
  scanTime: Timestamp,
  scanResult: "SUCCESS" | "FAILURE",
  totalAmount?: number,
  failureReason?: string
}
```

---

#### `analytics_aggregates/{docId}` — Pre-aggregated metrics

- **Daily item consumption:** `analytics_aggregates/daily_consumption_{date}` with map `itemId -> consumed`.
- **Hourly order counts:** `analytics_aggregates/hourly_orders_{date}` with map `hour -> count` (or similar).
- Updated by scheduled Cloud Functions or triggered on serve/order; clients read these for dashboards instead of scanning orders/logs.

---

#### `settings/global` (single doc)

- Keep current structure; read-heavy, write rare. Cache aggressively (e.g. 60s) in client.

---

#### `carts/{userId}` (optional; can be client-only for cost)

- If stored in Firestore: small doc, merge writes. Consider TTL cleanup via scheduled function.

---

## 2. Distributed Inventory System

### 2.1 Problem

- Single document per item with a `consumed` (or `available`) field causes a **write hotspot** when many servers serve the same item simultaneously (e.g. popular dish at lunch).
- Firestore limits sustained writes to ~1 write/sec per document; exceeding this causes contention and increased latency.

### 2.2 Sharded counter design

- **Concept:** Each item has N shard documents. Each “consume” operation picks a random shard and increments it. Total consumed = sum of all shards.

**Collection:** `inventory_shards/{itemId}/shards/shard_{0..N-1}`  
(or top-level `inventory/{itemId}_shard_{k}` if you prefer flat structure)

**Shard document:**

```text
{
  count: number,           // FieldValue.increment(1) on each serve
  lastUpdated: Timestamp
}
```

- **Read:** Sum `count` across all N shards (single batch get by doc IDs).  
- **Write:** Cloud Function in `serveItem` does `FieldValue.increment(1)` on **one** shard chosen as `shard_{hash(orderId + itemId + servedAt) % N}` (or random) to spread writes.

### 2.3 Example: 20 shards per item

- Up to ~20 writes/sec per item before hitting per-doc limits; sufficient for a single hot item at peak.
- **Opening stock:** Store in a separate doc `inventory_meta/{itemId}` (rarely written) or in `menu/{itemId}`.  
  **Available = openingStock - sum(shards.count)**. Compute in Cloud Function or in a scheduled job that writes to `inventory_meta/{itemId}.available` for fast reads.

### 2.4 Document layout summary

```text
inventory_meta/{itemId}
  openingStock: number
  available: number        // Updated by Function after aggregation
  lastAggregatedAt: Timestamp

inventory_shards/{itemId}/shards/shard_0 .. shard_N-1
  count: number
  lastUpdated: Timestamp
```

- **Serve flow:** Function runs transaction: read order, validate, update order items + write serveLog, then **increment one shard** (no need to read shard in transaction if you only increment). Optionally run a periodic job to set `inventory_meta/{itemId}.available` from shard sum.

---

## 3. Cloud Functions Architecture

### 3.1 Role of Cloud Functions

- **All critical mutations** (createOrder, confirmPayment, validateQR, serveItem, cancelOrder, inventory updates) run in Callable or HTTP functions so that:
  - Business rules run server-side (no client manipulation).
  - Firestore transactions and security stay consistent.
  - You can add rate limiting, auth checks, and fraud checks in one place.

### 3.2 Function list and transactions

| Function | Trigger | Responsibility | Transaction usage |
|----------|--------|-----------------|--------------------|
| `createOrder` | Callable | Validate items, check inventory (read aggregate), create order, optionally reserve stock | Transaction: read inventory_meta or shard sum, write order; optionally decrement reserve. |
| `confirmPayment` | Callable | Verify cashier role, set payment SUCCESS, generate QR, update order | Transaction: read order (idempotent if already SUCCESS), update order. |
| `validateQRCode` | Callable | Verify QR signature, expiry, payment; set qrStatus USED, orderStatus ACTIVE; write scanLog | Transaction: read order, update order, create scanLog. |
| `serveItem` | Callable | Verify server role, decrement remainingQty, update order status, write serveLog, increment inventory shard | Transaction: read order + (optional) inventory_meta, update order, create serveLog; then increment one shard (can be outside tx). |
| `updateInventory` | Callable (admin) | Set opening stock or adjust available (e.g. stock intake) | Transaction or single write to inventory_meta. |
| `cancelOrder` | Callable | Set order CANCELLED, revert inventory if already reserved | Transaction: read order, update order, adjust inventory. |
| `fraudDetection` | Firestore trigger (onCreate orders) or Callable | Check rate per user/IP, duplicate order patterns, impossible amounts | No transaction; read-only checks + optional write to `flags/{orderId}` or alert. |

### 3.3 Example: `createOrder` (Callable)

```javascript
const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.createOrder = functions
  .runWith({
    timeoutSeconds: 30,
    memory: "512MB",
    minInstances: 0,
    maxInstances: 20,
  })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required");
    const { items, paymentType, userName, cafeteriaId } = data;
    const uid = context.auth.uid;

    const db = admin.firestore();
    const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    await db.runTransaction(async (tx) => {
      const orderRef = db.collection("orders").doc(orderId);
      const batch = [];
      for (const item of items) {
        const metaRef = db.doc(`inventory_meta/${item.id}`);
        const snap = await tx.get(metaRef);
        const meta = snap.data();
        const available = (meta && meta.available) ?? 0;
        if (available < item.quantity) {
          throw new functions.https.HttpsError("failed-precondition", `Insufficient stock: ${item.name}`);
        }
        batch.push({ ref: metaRef, qty: item.quantity });
      }
      for (const { ref, qty } of batch) {
        tx.update(ref, { available: admin.firestore.FieldValue.increment(-qty), lastUpdated: admin.firestore.FieldValue.serverTimestamp() });
      }
      const orderDoc = {
        orderId, userId: uid, userName,
        items, totalAmount: data.totalAmount, paymentType,
        paymentStatus: "PENDING", orderStatus: "PENDING", qrStatus: "PENDING_PAYMENT",
        cafeteriaId: cafeteriaId || "main", createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      tx.set(orderRef, orderDoc);
    });

    return { orderId };
  });
```

- **Note:** If you use **sharded** inventory, in the transaction you would read `inventory_meta/{itemId}.available` (pre-aggregated) instead of summing shards; the periodic job keeps `available` in sync with shards. Reserve in transaction by decrementing `available`; on cancel/expiry, increment back.

### 3.4 Example: `serveItem` with shard increment

```javascript
exports.serveItem = functions
  .runWith({ timeoutSeconds: 20, memory: "256MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required");
    const { orderId, itemId, servedBy } = data;
    const db = admin.firestore();
    const orderRef = db.collection("orders").doc(orderId);
    const N = 20;
    const shardIndex = Math.abs(hashCode(`${orderId}_${itemId}_${Date.now()}`)) % N;
    const shardRef = db.doc(`inventory_shards/${itemId}/shards/shard_${shardIndex}`);

    await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new functions.https.HttpsError("not-found", "Order not found");
      const order = orderSnap.data();
      if (order.paymentStatus !== "SUCCESS" || order.qrStatus !== "USED") {
        throw new functions.https.HttpsError("failed-precondition", "Invalid order state");
      }
      const items = order.items.map((it) => ({ ...it }));
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx === -1 || items[idx].remainingQty <= 0) {
        throw new functions.https.HttpsError("failed-precondition", "Item not found or already served");
      }
      items[idx].servedQty = (items[idx].servedQty || 0) + 1;
      items[idx].remainingQty = items[idx].remainingQty - 1;
      const allServed = items.every((i) => i.remainingQty <= 0);
      const updates = {
        items,
        orderStatus: allServed ? "COMPLETED" : order.orderStatus,
        servedAt: allServed ? admin.firestore.FieldValue.serverTimestamp() : order.servedAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      tx.update(orderRef, updates);
      const serveLogRef = db.collection("serveLogs").doc();
      tx.set(serveLogRef, {
        orderId, itemId, itemName: items[idx].name, quantityServed: 1,
        servedBy, servedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await shardRef.update({
      count: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true };
  });

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}
```

- Transaction covers order + serveLog; shard increment is outside the transaction to avoid long reads and to keep hotspot spread across shards.

---

## 4. Security Model (Firestore Rules)

### 4.1 Principles

- **Students:** Can create orders (or only via Callable); can read **own** orders and active menu/settings; **cannot** read/write inventory, serveLogs, scanLogs, or other users’ orders (unless you explicitly allow “read order by id” for QR flow — then restrict to orderId passed in or token).
- **Servers:** Can read orders (for serving), write serveLogs (create only), read inventory; **cannot** change paymentStatus or payment-related fields.
- **Cashiers:** Can read orders, update only payment/QR/confirmation fields on orders; **cannot** change items or serveLogs.
- **Admins:** Full access to menu, users, settings, reports; delete where needed.

### 4.2 Rule structure (conceptual)

- **orders:**  
  - create: allow only if request.auth != null OR allow guest (e.g. request.resource.data.userId matches pattern `guest_*`).  
  - read: allow if authenticated and (resource.data.userId == request.auth.uid OR staff role). For guest orders, allow read if document’s userId matches a known guest id from request (e.g. from token).  
  - update: allow only for staff; restrict changed keys: cashier → paymentStatus, qrStatus, confirmedBy, confirmedAt, orderStatus, rejectedBy, rejectedAt; server → orderStatus, scannedAt, servedAt, items.  
  - delete: admin only.

- **menu:** read: true (public); write: admin only.

- **users:** read/write own doc or admin; delete admin only.

- **inventory_meta, inventory_shards:** read: server, cashier, admin; write: **no client write** (only Cloud Functions with admin SDK). So in rules: allow read for staff; allow write: false (all writes via Functions).

- **serveLogs, scanLogs:** read: staff; create: server (and admin); update/delete: admin only.

- **settings:** read: true; write: admin only.

- **analytics_aggregates:** read: admin (and optionally cashier for dashboard); write: false (Functions only).

### 4.3 Example rules (orders — key part)

```javascript
match /orders/{orderId} {
  allow read: if request.auth != null
    && (resource.data.userId == request.auth.uid
        || get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin','cashier','server']);
  allow create: if request.auth != null
    && request.resource.data.userId == request.auth.uid
    // or allow guest: request.resource.data.userId.matches('guest_.*');
  allow update: if request.auth != null
    && (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'
        || (get(...).data.role == 'cashier' && onlyPaymentKeys())
        || (get(...).data.role == 'server' && onlyServingKeys()));
  allow delete: if request.auth != null
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
}
```

- `onlyPaymentKeys()`: `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['paymentStatus','qrStatus','confirmedBy','confirmedAt','qr','orderStatus','rejectedAt','rejectedBy'])`
- `onlyServingKeys()`: `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['orderStatus','scannedAt','servedAt','items'])`

- **Inventory:** Prefer **deny all client writes**; Cloud Functions use Admin SDK and bypass rules. This gives strongest guarantee that only server logic updates inventory.

---

## 5. Real-Time Strategy

### 5.1 Where to use listeners

| Data | Listener? | Scope | Reason |
|------|-----------|--------|--------|
| Single order (student’s current order / QR) | Yes | `doc(orders, orderId)` | One doc; low cost; instant status. |
| Cashier pending list | Yes | Query: paymentType==CASH, paymentStatus==PENDING, limit(50), orderBy createdAt desc | Small, bounded result set. |
| Server “active orders” / pending items | Yes | Query: orderStatus==ACTIVE, paymentStatus==SUCCESS, qrStatus==USED, limit(100) | Bounded; critical for serving UX. |
| Menu | No (or optional) | getDocs + local cache / periodic refresh | Changes infrequent; avoid continuous listener. |
| Settings | No | getDoc + cache (e.g. 60s) | Rarely changes. |
| All orders for user | Prefer paginated getDocs or limit(20) listener | Query with limit | Avoid unbounded “all my orders” listener. |
| Admin “all orders” | No | Paginated getDocs or scheduled export | Too large for real-time. |
| Inventory | No | Read via Callable or getDoc(inventory_meta) with cache | Updated by Functions; no need for sub-second UI. |

### 5.2 Reducing read cost

- **Subscribe only to what’s on screen:** e.g. one order doc when student is on QR page; one query for cashier queue; one for server queue.
- **Unsubscribe on unmount:** Always return and call `unsubscribe()` from `onSnapshot` when component unmounts.
- **Use limit():** Every list query should have `limit(30)` or `limit(50)`.
- **Avoid listeners for static data:** Menu, settings → fetch once or with TTL cache; refresh on focus or after long idle if needed.
- **Offline:** Rely on Firestore persistence for the single-order and queue listeners so they work offline and sync when back online.

### 5.3 Example: Student QR view

```javascript
useEffect(() => {
  if (!orderId) return;
  const unsub = onSnapshot(doc(db, "orders", orderId), (snap) => {
    if (snap.exists()) setOrder(firestoreToOrder(snap.id, snap.data()));
  }, (err) => setError(err));
  return () => unsub();
}, [orderId]);
```

- One document read per update; no collection scan.

---

## 6. Query Optimization

### 6.1 Composite indexes (recommended)

- **orders**
  - `userId` (ASC) + `paymentStatus` (ASC) + `createdAt` (DESC) — “my orders” / “my active QR”.
  - `paymentType` (ASC) + `paymentStatus` (ASC) + `createdAt` (DESC) — cashier pending.
  - `orderStatus` (ASC) + `paymentStatus` (ASC) + `qrStatus` (ASC) + `scannedAt` (DESC) — server active orders.
  - `createdAt` (ASC/DESC) for date-range reports (with paymentStatus if filtered).
- **serveLogs:** `orderId` (ASC) + `servedAt` (DESC); `servedAt` (DESC) for recent logs.
- **scanLogs:** `scanTime` (DESC); optional `orderId` if you query by order.

Define in `firestore.indexes.json` and deploy with `firebase deploy --only firestore:indexes`.

### 6.2 Pagination

- **Cursor-based:** Use `orderBy('createdAt', 'desc').limit(20)`. Next page: `startAfter(lastDoc).limit(20)`.
- **Offset is discouraged:** `offset()` still reads and charges for skipped docs.

### 6.3 Query limits and best practices

- Always use `limit()` (e.g. 20–50 for lists).
- Avoid inequality on different fields (use one range + equality filters).
- For reporting (e.g. “today’s revenue”), prefer:
  - Pre-aggregated docs updated by Functions, or
  - Single date-partitioned collection (e.g. orders by date) with a narrow date range and limit.

---

## 7. Inventory Forecasting Logic

### 7.1 Metrics to track (in `inventory_meta` or analytics)

- **consumedToday:** Sum of shards (or from serveLogs) per item per day.
- **consumptionRate:** Average servings per hour over last 7 days (or configurable window).
- **remainingStock:** `openingStock - totalConsumed` (or use `available` if you maintain it).
- **predictedStockout:** Time when `available` hits zero given current rate.

### 7.2 Formulas

- **Consumption rate (per hour):**
  - `rate_h = consumedLast24h / 24` or
  - `rate_h = sum(served last 7 days) / (7 * operating_hours_per_day)`.
- **Remaining stock:**
  - `remaining = openingStock - sum(shard counts)` (or `inventory_meta.available`).
- **Predicted stockout (hours):**
  - `hoursUntilStockout = remaining / rate_h` (if rate_h > 0).
- **Alert when:** `hoursUntilStockout < threshold` (e.g. 1 hour) or `remaining < minThreshold`.

### 7.3 Implementation

- **Scheduled Cloud Function** (e.g. every 15 min): For each item, read shard sum (or `inventory_meta`), compute `consumedToday` from serveLogs or shards, update `inventory_meta.{itemId}` with `available`, `consumedToday`, `lastAggregatedAt`.
- **Optional:** Another scheduled job that computes `consumptionRate` and `predictedStockout` and writes to `analytics_aggregates/stockout_predictions_{date}` for dashboard and alerts (e.g. Cloud Monitoring or email).

---

## 8. Peak Traffic Protection

### 8.1 Batching

- **Client:** Do not send one request per item; send one “createOrder” with full cart.
- **Server:** In Functions, process one order per invocation; use transactions to keep order + inventory consistent. For reporting, batch reads in scheduled jobs rather than per order.

### 8.2 Rate limiting

- **Per user:** In Callable, check Firestore or Redis (if you add it) for “orders in last N minutes” per uid; reject if above threshold (e.g. 5 orders per 10 min).
- **Per function:** Use Cloud Functions quotas and optional rate-limiting middleware (e.g. check a “request_count” doc per minute per user or IP).

### 8.3 Server validation

- All state changes (payment confirm, QR validate, serve item) in Cloud Functions with:
  - Auth check (context.auth).
  - Role check (Firestore users/{uid}.role).
  - Idempotency where possible (e.g. “already SUCCESS” → return success).
  - Stock check before commit (in transaction).

### 8.4 Optimistic UI

- **Create order:** Show “Order placed” and orderId immediately; subscribe to `doc(orders, orderId)` for real status (PENDING → SUCCESS, etc.).
- **Serve item:** Client calls Callable; on success, UI updates; listener on order doc confirms final state. Avoid blocking UI on round-trip.

---

## 9. Observability and Monitoring

### 9.1 Performance

- **Cloud Monitoring:** Firestore metrics (read/write ops, latency); Cloud Functions (invocations, latency, errors). Dashboards for “orders/min”, “serveItem latency p99”.
- **Custom metrics:** In Functions, log orderId, duration, outcome; or use Cloud Monitoring custom metrics (e.g. “order_created” counter, “serve_duration” distribution).

### 9.2 Error logging

- **Structured logs:** In Cloud Functions use `functions.logger.info({ orderId, userId, action, error })` so logs are searchable in Cloud Logging.
- **Alerts:** Create alert policies for Function error rate > X%, or Firestore read/write spikes.

### 9.3 Fraud and abuse

- **fraudDetection:** On order create (trigger or inside createOrder), check: orders per userId in last 1 hour; totalAmount vs historical average; duplicate item list in short window. If suspicious, write to `flags/{orderId}` and/or notify admin (email, Slack).
- **Alerts:** Unusual spike in rejected payments, or many “TOKEN_ALREADY_USED” from same IP/server.

### 9.4 Traffic analytics

- **Pre-aggregates:** Daily/hourly order counts and revenue in `analytics_aggregates` (updated by scheduled or triggered Functions). Admin dashboard reads these instead of scanning orders.
- **Dashboards:** Cloud Monitoring + optional BigQuery export for Firestore (if you enable it) for ad-hoc analysis.

---

## 10. Scalability Roadmap (10k → 50k users/day)

### 10.1 Partitioning

- **Orders:** Move to date-partitioned collections `orders_by_date/{date}/orders/{orderId}` so writes and indexes are spread; client and Functions resolve “today” and “orderId” to the right collection.
- **Inventory:** Already sharded; increase shard count if a single item exceeds ~1 write/sec sustained.
- **Logs:** serveLogs/scanLogs can stay in single collection with TTL or date-based cleanup; for 50k/day, consider partitioning by date if query patterns allow.

### 10.2 Read optimization

- **Cache menu and settings:** CDN or in-memory cache in a small backend (e.g. Cloud Run) that reads Firestore once per minute and serves REST; or keep client cache with short TTL.
- **Pre-aggregated reports:** All admin dashboards from `analytics_aggregates` and daily jobs; no live full collection scans.

### 10.3 Caching layer

- **Optional Redis/Memorystore:** For rate limiting (orders per user per minute), or “available” per item if you want sub-second reads without hitting Firestore on every check. Cloud Function can update Redis on serve; clients call a small API that reads from Redis.
- **Firestore local cache:** Already used; ensure persistence is enabled so repeated reads are served from cache when possible.

### 10.4 Backend evolution

- **Phase 1 (current):** React + Firestore + Callable Functions; rules and transactions for integrity.
- **Phase 2:** Add Callables for all mutations; move inventory to shards + inventory_meta; add rate limit and fraud checks.
- **Phase 3:** Date-partition orders; add analytics_aggregates and scheduled jobs; tighten listeners to single-doc and bounded queries only.
- **Phase 4 (50k):** Consider a thin REST/GraphQL API on Cloud Run that uses Firestore (and optionally Redis) for reads, with Callables still for writes; or keep Callables and add read-through cache for menu/settings and inventory_meta.

---

## Performance Best Practices (Summary)

1. **No client writes to orders/inventory/serveLogs** — use Callables and Admin SDK.
2. **Shard hot inventory documents** — one increment per serve spread across N shards.
3. **Use transactions only where needed** — order + serveLog in one transaction; shard increment outside.
4. **Listen only to one order doc or bounded list queries** — never unbounded collection listeners.
5. **Pagination with limit + startAfter** — no offset.
6. **Pre-aggregate for reporting** — no full collection scans in request path.
7. **Index every query** — composite indexes for (userId, status, createdAt), (paymentType, paymentStatus, createdAt), etc.
8. **Rate limit and validate in Functions** — per user and server-side checks.
9. **Optimistic UI + single-doc listener** — for order status and serving.
10. **Monitor and alert** — Function errors, latency, and fraud indicators.

---

## File and Deployment Checklist

- **Firestore:** `firestore.rules`, `firestore.indexes.json` — update per this blueprint; deploy with `firebase deploy --only firestore`.
- **Cloud Functions:** New repo or `functions/` in project; deploy with `firebase deploy --only functions`.
- **Client:** Replace direct Firestore writes for orders/confirm/serve/validate with `httpsCallable('createOrder', ...)` etc.; keep real-time listeners only where specified above.

This blueprint is designed to make the JOE cafeteria backend production-grade, scalable to 10k–50k users/day, with strong data integrity, controlled cost, and clear observability.

---

## Appendix A: Composite Index Definitions (firestore.indexes.json)

```json
{
  "indexes": [
    {
      "collectionGroup": "orders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "paymentStatus", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "orders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "paymentType", "order": "ASCENDING" },
        { "fieldPath": "paymentStatus", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "orders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "orderStatus", "order": "ASCENDING" },
        { "fieldPath": "paymentStatus", "order": "ASCENDING" },
        { "fieldPath": "qrStatus", "order": "ASCENDING" },
        { "fieldPath": "scannedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "orders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "createdAt", "order": "ASCENDING" },
        { "fieldPath": "paymentStatus", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "serveLogs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "servedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "scanLogs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "scanTime", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

---

## Appendix B: Cloud Functions Project Layout

```
project-root/
  firebase.json
  firestore.rules
  firestore.indexes.json
  functions/
    package.json
    index.js          # exports createOrder, confirmPayment, validateQRCode, serveItem, updateInventory, cancelOrder, fraudDetection
    lib/
      orders.js      # createOrder, cancelOrder
      payment.js     # confirmPayment
      qr.js          # validateQRCode
      serve.js       # serveItem, inventory shard increment
      inventory.js   # updateInventory, aggregate shards (scheduled)
      fraud.js       # fraudDetection (trigger or callable)
    .env (or Secret Manager) for QR secret, rate-limit config
```

**package.json (functions):**

```json
{
  "name": "joe-cafeteria-functions",
  "engines": { "node": "18" },
  "main": "index.js",
  "dependencies": {
    "firebase-admin": "^11.x",
    "firebase-functions": "^4.x"
  }
}
```

---

## Appendix C: Security Rules Helpers (Full)

```javascript
function isAuthenticated() {
  return request.auth != null;
}
function getUserRole() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
}
function hasRole(role) {
  return isAuthenticated() && getUserRole() == role;
}
function onlyPaymentKeys() {
  return request.resource.data.diff(resource.data).affectedKeys()
    .hasOnly(['paymentStatus','qrStatus','confirmedBy','confirmedAt','qr','orderStatus','rejectedAt','rejectedBy']);
}
function onlyServingKeys() {
  return request.resource.data.diff(resource.data).affectedKeys()
    .hasOnly(['orderStatus','scannedAt','servedAt','items']);
}
// inventory_meta / inventory_shards: allow read for staff; allow write: false (Functions only)
match /inventory_meta/{itemId} {
  allow read: if isAuthenticated() && (hasRole('admin') || hasRole('server') || hasRole('cashier'));
  allow write: if false;
}
match /inventory_shards/{itemId}/shards/{shardId} {
  allow read: if isAuthenticated() && (hasRole('admin') || hasRole('server') || hasRole('cashier'));
  allow write: if false;
}
```

---

## Appendix D: Client Migration (Callable Usage)

Replace direct Firestore writes with Callables:

```javascript
import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(app, "us-central1");

// Create order
const createOrder = httpsCallable(functions, "createOrder");
const { data } = await createOrder({ items, totalAmount, paymentType, userName, cafeteriaId });
const orderId = data.orderId;
// Then: onSnapshot(doc(db, "orders", orderId), ...)

// Confirm cash payment (cashier)
const confirmPayment = httpsCallable(functions, "confirmPayment");
await confirmPayment({ orderId });

// Validate QR (server)
const validateQRCode = httpsCallable(functions, "validateQRCode");
const result = await validateQRCode({ qrPayload: scannedData });

// Serve item (server)
const serveItem = httpsCallable(functions, "serveItem");
await serveItem({ orderId, itemId, servedBy: context.auth.uid });
```

Keep listeners only for: single order doc, cashier pending queue (bounded query), server active orders (bounded query).
