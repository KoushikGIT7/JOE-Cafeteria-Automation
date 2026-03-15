# Production-Readiness Audit: Smart Cafeteria Backend

**Stack:** Firebase Auth, Cloud Firestore, Cloud Functions, FCM  
**Scope:** orders, sharded inventory, QR validation, preparation workflow, pickup windows, push notifications, admin analytics  
**Focus:** reliability, scalability (500+ concurrent lunch orders), cost efficiency — **without redesign**.

---

## 1. Race Conditions

### 1.1 Stock check vs. serve (createOrder → serveItem)

**Issue:** `createOrder` checks stock by reading `inventory_meta` per item **outside** any transaction. Orders are written only after all checks pass. Between the last `inventory_meta` read and the order write (and later `serveItem`), other `serveItem` calls can decrement stock via shards. So two orders can both see “available ≥ need,” both get created, and one can later fail at serve with `OUT_OF_STOCK`.

**Impact:** Students can place an order that later fails at the counter; no automatic refund or retry.

**Improvement (no redesign):**

- **Short term:** Keep current behavior but ensure client and server show a clear message when serve fails with `OUT_OF_STOCK` (e.g. “Item ran out; please reorder or choose another item”) and consider a simple “retry once” or “replace item” path in the server UI.
- **Medium term:** Add a **soft reserve** at order creation: inside a transaction, read `inventory_meta` and sum of shards for each item, and if available ≥ need, write a **reservation** doc (e.g. `inventory_reservations/{orderId}` with item quantities and TTL). `serveItem` would consume from the reservation (and decrement shards) and clear the reservation. Reservations would expire (e.g. scheduled cleanup) if the order is never paid/served. This keeps the existing flow but ties “available” to a concrete reservation at create time.

### 1.2 Duplicate QR scan (validateQRCode)

**Issue:** `validateQRCode` reads the order once **outside** the transaction, checks `qrStatus === "ACTIVE"`, then runs a transaction that only updates the order and writes `scanLogs`. Two concurrent scans of the same QR can both see `ACTIVE`, both run the transaction, and both write a scan log. Order state ends up `USED` (idempotent), but **duplicate scanLogs** are created.

**Impact:** Inflated scan counts, possible confusion in reporting; no double-serve because `serveItem` still checks order state.

**Improvement:**

- Inside the **same** transaction: (1) `tx.get(orderRef)`, (2) if `order.qrStatus !== "ACTIVE"` then abort (e.g. throw “TOKEN_ALREADY_USED”), (3) else `tx.update(orderRef, { qrStatus: "USED", ... })` and `tx.set(scanLogsRef.doc(), ...)`. This makes the “claim” of the QR atomic and prevents duplicate scanLogs.

### 1.3 updateServeFlowStatus PREPARING queue

**Issue:** When moving an order to `PREPARING`, the function reads all orders with `serveFlowStatus in ["PREPARING","READY"]` and sums prep time to compute queue delay. Two servers moving two orders to `PREPARING` at nearly the same time can each see the same “pending” set and compute similar windows, so **pickup windows can overlap** more than intended.

**Impact:** Acceptable for “best effort” windows; at 500+ concurrent the queue snapshot is already an approximation.

**Improvement (optional):** Use a transaction that (1) reads current PREPARING/READY count (or a single “queue tail” doc), (2) increments or appends this order, (3) writes the order’s pickup window. This gives a stricter ordering at the cost of one more contended doc (or a small “queue” structure). If product is fine with best-effort windows, document the behavior and leave as is.

---

## 2. Firestore Cost Risks

### 2.1 createOrder read amplification

**Current:** Per order: 1 `settings` read + **N** `inventory_meta` reads (N = distinct item IDs) + 1–2 order queries (recent + active count) + 1 order write. Example: 10 distinct items → ~13 reads, 1 write per order. At 500 orders in a rush, that’s on the order of **6.5k reads** from this path alone.

**Improvement:**

- **Batch inventory_meta reads:** Use `db.getAll(...)` with up to 30 `inventory_meta` doc refs per order (Firestore allows 30 in one `getAll`). Cuts N round-trips to 1 (or 2 if N > 30).
- **Cache settings:** Read `settings.global` once per instance (e.g. in-memory with 60s TTL) instead of per request, and optionally use Firestore `getDoc` only on cache miss.

### 2.2 serveItem reads per invocation

**Current:** One transaction does: 1 order + 1 `inventory_meta` + **full shards subcollection** (e.g. 10 docs). So ~12 reads per serve. At 500 concurrent serves, **~6k reads** in a short window.

**Improvement:**

- **Cap shard count:** Keep `INVENTORY_SHARD_COUNT` at 10 (or similar); document that increasing it increases read cost per serve.
- **Avoid re-reading meta when possible:** You already validate stock inside the transaction via `totalStock` and sum(shards). No change needed for correctness; the cost is inherent to consistency.

### 2.3 onInventoryShardWritten trigger

**Current:** Each shard write triggers a function that (when not throttled) reads meta, reads all shards, reads `inventory`, then writes `inventory_meta`. So multiple reads + 1 write per shard write. Throttle (e.g. 3s) reduces invocations but not the read volume of each run.

**Improvement:**

- Keep the throttle; consider **increasing to 5s** during peak to further reduce trigger runs.
- Ensure the trigger uses a **single** `getAll` for shard refs (or one collection read) and one meta read; avoid extra `inventory` read if `totalStock` is always in `inventory_meta` after first aggregation.

### 2.4 Client listeners

**Current:** Dashboards and UIs use multiple `onSnapshot` listeners (e.g. `listenToPreparationOrders`, `listenToUserOrders`, `listenToInventoryMeta`, `listenToMenu`). Each listener pays for initial query + ongoing updates. Many open tabs or heavy use of “all orders” views increase read volume.

**Improvement:**

- Use **limit()** on all list queries (you already do on preparation orders).
- Prefer **polling** for admin “report” views (e.g. every 60s) instead of real-time listeners where real-time is not required.
- Document recommended practices: one primary listener per view, unmount/unsubscribe when leaving the page.

### 2.5 Security rules: getUserRole()

**Current:** Rules call `get(/databases/$(database)/documents/users/$(request.auth.uid))` for role checks. Every secured request evaluates rules and can trigger **one user doc read per rule evaluation** (e.g. one read for read, one for write).

**Improvement:**

- Where possible, **narrow rules** so that not every read/write needs a role (e.g. orders are create/update: false from client, so no user read for order writes). For client writes (e.g. `carts`, `users/{uid}`), the single get is acceptable; document that admin-heavy dashboards may see higher read rates due to rule evaluation.

---

## 3. Scalability at 500+ Concurrent Lunch Orders

### 3.1 Function concurrency and cold starts

**Current:** `createOrder`: `maxInstances: 20`, 512MB, 30s. At 500 concurrent orders over a short window, 20 instances can queue; some requests may approach or hit timeout.

**Improvement:**

- **Increase maxInstances** for `createOrder` (e.g. 40–60) during known peak; use **minInstances: 1** (or 2) during lunch hours to reduce cold starts. Consider **concurrency = 1** per instance to avoid one long request blocking others on the same instance.
- **Optimize createOrder:** Batch inventory reads and cache settings (see §2.1) to shorten duration so more requests complete within 30s.

### 3.2 Firestore write throughput

**Current:** Orders and serveLogs are 1 doc per order/serve; scanLogs 1 per scan; inventory shards 1 write per item served. At 500 orders and ~2 items per order, that’s 500 order writes + ~1000 serve writes + 1000 shard writes + 500+ scanLogs. Firestore’s default limit is 10k writes/s per DB; you’re well below, but **single-doc hot spots** (e.g. one “queue” doc or one counter) would be the main risk.

**Improvement:**

- Keep **sharded counters** for inventory; avoid a single “order counter” or “queue tail” doc that every request updates. If you add a queue structure, use **distributed** docs (e.g. one doc per time window or per server) to spread writes.

### 3.3 updateServeFlowStatus PREPARING query

**Current:** Query `orders` where `orderType == "PREPARATION_ITEM"` and `serveFlowStatus in ["PREPARING","READY"]` with no limit. At 500+ preparation orders, this can return a large set and consume more memory and read cost.

**Improvement:**

- Add **.limit(100)** (or similar) and document that queue delay is approximate when there are more than 100 in-flight preparation orders. Optionally add a composite index that supports this query with limit.

### 3.4 FCM and notificationLogs

**Current:** One `notificationLogs` write per ORDER_READY / PICKUP_REMINDER; FCM uses `sendEachForMulticast`. No bottleneck identified at 500 orders.

**Improvement:** None required for scale; keep batch send and single log per event.

---

## 4. Monitoring and Logging

### 4.1 Gaps

- **No structured metrics:** Success/failure and latency are not exported to Cloud Monitoring (e.g. custom metrics or log-based metrics).
- **No alerting:** No alerts on high error rate, timeout rate, or Firestore throttling.
- **No request correlation:** Logs do not consistently carry a request ID or order ID across createOrder → confirmPayment → serveItem.
- **No dashboards:** No single pane for “orders/min,” “serve errors,” “FCM delivery rate,” “inventory trigger lag.”

### 4.2 Improvements (no redesign)

- **Structured logs:** In every callable, log at least: `orderId` (if any), `userId` (or role), outcome (`success` / `error_code`), and duration. Use a single JSON structure (e.g. `functions.logger.info("createOrder", { orderId, userId, success, durationMs, errorCode })`).
- **Cloud Monitoring:** Create **log-based metrics** for:
  - Count of `createOrder` success vs. failure (by error code).
  - Count of `serveItem` success vs. OUT_OF_STOCK / other errors.
  - Count of `validateQRCode` failures (expired, duplicate, invalid).
- **Alerts:** Alert when error rate for `createOrder` or `serveItem` exceeds a threshold (e.g. 5%) over 5 minutes, or when timeout rate is non-zero.
- **Optional:** Add a **lightweight audit collection** (e.g. `auditLogs` with orderId, action, timestamp, actor) for critical actions (order created, payment confirmed, order served) and retain for 30 days; use for debugging and compliance, not for real-time UI.

---

## 5. Missing Scheduled Aggregation Jobs

### 5.1 Current

- **scheduledPickupReminder:** Every 2 minutes for pickup reminders. Good.
- **onInventoryShardWritten:** Near real-time aggregation from shards to `inventory_meta` (throttled). Good.
- No daily/hourly rollups for analytics or cost control.

### 5.2 Recommended additions

- **Daily notification summary:** Scheduled job (e.g. once per day) that:
  - Reads `notificationLogs` for the last 24h (or writes to a pre-aggregated doc per day).
  - Writes a small summary doc (e.g. `notificationDailyStats/{date}`: `orderReadySent`, `orderReadySuccess`, `reminderSent`) for admin analytics and to avoid ad-hoc full collection scans.
- **Daily order/serve rollup (optional):** If admin analytics need “orders per day” or “serves per item per day,” a scheduled job can aggregate from `orders` and `serveLogs` into `dailyOrderStats/{date}` (counts only) so dashboards read one doc per day instead of scanning large collections.
- **FCM token cleanup:** Scheduled job (e.g. weekly) that deletes `users/{uid}/fcmTokens` docs where `updatedAt` is older than 90 days to limit storage and avoid sending to stale tokens.

---

## 6. Data Archiving Strategy

### 6.1 Current

- No TTL or archival; `orders`, `serveLogs`, `scanLogs`, `notificationLogs` grow unbounded.
- Long-term growth increases storage cost and can slow queries that scan by date.

### 6.2 Recommendations (no schema redesign)

- **Retention policy:** Define retention (e.g. 90 days for orders and logs in the live DB). Document it and implement archival so the live collection is not queried for older data.
- **Export to Cloud Storage:** Scheduled job (e.g. daily) that:
  - Queries `orders` (and optionally `serveLogs`, `scanLogs`) where `createdAt` or `servedAt` is older than 90 days.
  - Exports to Cloud Storage (e.g. JSON or Parquet) with path like `gs://bucket/archive/orders/YYYY-MM-DD.json`.
  - After successful export, **delete** the exported documents (or move to a separate “archive” collection with a different name to avoid accidental client access). Use batched deletes (500 per batch) to stay within limits.
- **notificationLogs:** Same idea: export by `sentAt` (e.g. older than 90 days), then delete. Keep `notificationDailyStats` as the long-term summary.
- **Indexes:** Drop composite indexes that are only used for archival queries once you stop querying the live collection by those fields; add indexes only for the export query (e.g. `createdAt` ASC with limit).

---

## 7. Security Rule Improvements

### 7.1 orders: read if true

**Current:** `allow read: if true` on `orders` allows unauthenticated read of any order. Likely intentional for QR display (e.g. public kiosk) but exposes all order data to anyone who knows or guesses document IDs.

**Improvement:**

- If only the order’s own data is needed for QR display, restrict to the order’s owner or a known “kiosk” role:
  - `allow read: if request.auth != null && (resource.data.userId == request.auth.uid || hasRole('server') || hasRole('cashier') || hasRole('admin'));`
- If unauthenticated read is required (e.g. QR on a shared screen), keep `read: if true` but document the risk and consider short-lived tokens or a backend endpoint that returns only the minimal fields needed for the QR screen.

### 7.2 menu: read if true

**Current:** Menu is world-readable. Acceptable for a cafeteria; no change required unless you need to hide items from unauthenticated users.

### 7.3 notificationLogs

**Current:** Read only for admin; create/update/delete false. Good.

### 7.4 Rate limiting

**Current:** No rate limiting in rules; burst protection is in Cloud Functions (createOrder: 25 items, 10 per item, 5s between orders per user).

**Improvement:** Firestore rules cannot enforce per-user rate limits. Keep rate and burst limits in Cloud Functions; optionally add **App Check** so only your app can call the callables, reducing abuse from scripts.

### 7.5 Summary

- Tighten **orders** read to authenticated user + own order (or document why public read is required).
- Add **App Check** for backend callables.
- Keep **notificationLogs** and other “Functions-only” collections as create/update/delete: false.

---

## 8. Failure Recovery Strategies

### 8.1 createOrder

- **Timeout:** Client receives timeout; order may or may not have been written. Risk of duplicate order if client retries.
- **Improvement:** Use **idempotency keys**: client sends `idempotencyKey: string` (e.g. UUID). Backend stores processed keys in a small collection (e.g. `idempotency/{key}` with TTL or 24h retention). If `createOrder` is called again with the same key, return the existing `orderId` and do not create a second order. Reduces duplicate orders on retry.

### 8.2 confirmPayment

- **Already idempotent:** If `paymentStatus === "SUCCESS"`, the transaction returns without updating. Good.
- **Failure after transaction:** If the client crashes after the transaction commits but before receiving the response, the order is still confirmed; client can refetch by orderId. No change needed.

### 8.3 serveItem

- **OUT_OF_STOCK in transaction:** Transaction aborts; no partial update. Good.
- **Failure after transaction:** If the transaction commits but the response is lost, the client might retry. A second `serveItem(orderId, itemId)` would see `remainingQty <= 0` and return “Item already fully served.” So **idempotent**. No change required.

### 8.4 FCM send

- **Current:** Batch send with fallback to single sends; invalid tokens are removed; one notificationLogs doc per event.
- **Improvement:** If FCM is temporarily unavailable (e.g. 5xx), consider writing a “pending notification” doc (e.g. `pendingNotifications/{orderId}` with type ORDER_READY and payload). A **scheduled or retry function** can poll this collection and retry FCM send (e.g. up to 3 times with backoff), then delete or mark failed. Prevents “order ready but no push” when FCM has a short outage.

### 8.5 onInventoryShardWritten

- **Current:** Throttled; if the function fails, the trigger may retry (Firebase default). Repeated failure could leave `inventory_meta` stale (consumed lagging behind shards).
- **Improvement:** Ensure the trigger is **idempotent** (re-running produces the same meta from current shard state). Add **logging** on failure (e.g. `functions.logger.error("onInventoryShardWritten failed", { itemId, error })`) and an alert on repeated failures. Optionally a **scheduled job** (e.g. every 15 minutes) that, for each itemId that has shards, recomputes `inventory_meta.consumed` and `available` from shards and updates meta. This acts as a reconciliation and fixes any lag from failed triggers.

### 8.6 Summary

- **Idempotency keys** for createOrder to avoid duplicates on retry.
- **Idempotent** serveItem and confirmPayment; document behavior on retry.
- **Retry + pending queue** for FCM when FCM is temporarily down.
- **Reconciliation job** for inventory_meta so failed shard triggers do not leave meta permanently stale.

---

## Summary Table

| Area                  | Finding / risk                                      | Improvement (no redesign)                                      |
|-----------------------|-----------------------------------------------------|----------------------------------------------------------------|
| Race conditions       | Stock check vs. serve; duplicate QR scan logs        | Soft reserve at create; atomic QR claim in transaction         |
| Firestore cost        | Many reads in createOrder/serveItem/triggers        | Batch meta reads; cache settings; throttle triggers; limit queries |
| 500+ concurrent       | createOrder queue; PREPARING query unbounded         | Higher maxInstances; minInstances; limit PREPARING query       |
| Monitoring            | No metrics, alerts, or correlation                  | Structured logs; log-based metrics; alerts; optional auditLogs  |
| Scheduled jobs        | No daily rollups or token cleanup                  | Daily notification stats; optional order rollup; FCM token cleanup |
| Archiving             | Unbounded growth                                   | Export + delete old orders/logs; 90-day retention              |
| Security              | orders world-readable; no App Check                 | Restrict order read to owner/role; App Check                   |
| Failure recovery      | Duplicate orders on retry; FCM/trigger failures     | Idempotency keys; FCM retry queue; inventory reconciliation   |

Implementing the items above in phases (starting with race-condition fixes, cost and scale tweaks, then monitoring, archiving, and security) will improve production readiness while keeping the existing architecture intact.
