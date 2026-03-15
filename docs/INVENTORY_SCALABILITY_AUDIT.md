# Inventory System Audit & Optimization (10K+ Users)

This document summarizes the architecture, optimizations, and recommendations for the real-time inventory system at 10,000+ daily users and lunch-time traffic spikes.

---

## 1. Architecture Explanation

- **inventory_meta**: Single source of truth for student-facing stock. Holds `totalStock`, `consumed` (from shard aggregation), and **cached** `available` and `stockStatus` so clients and listeners do minimal work.
- **inventory_shards**: Sharded counters per item (e.g. 10 shards). Each serve increments one random shard to spread writes and avoid document hotspot (500+ concurrent serves).
- **Aggregation**: A Firestore trigger `onInventoryShardWritten` runs when any shard is updated. It is **throttled** (skips if `inventory_meta.lastUpdated` was updated in the last 3 seconds) to cut write amplification during peaks. It recomputes `consumed`, `available`, and `stockStatus` and writes them to `inventory_meta`.
- **Order validation**: `createOrder` checks `totalStock - consumed >= quantity` per item and enforces **burst limits** (max 25 line items, max 10 quantity per item) to prevent abuse.
- **serveItem**: Single transaction: validate order and stock (read meta + sum shards), update order + serveLog, increment one random shard. No direct write to `inventory` or `inventory_meta` in the transaction.

---

## 2. Updated Firestore Schema

### inventory_meta/{itemId}

| Field | Type | Description |
|-------|------|-------------|
| totalStock | number | Set by admin (opening capacity) |
| consumed | number | Sum of shards; updated by trigger |
| **available** | number | Cached: totalStock - consumed |
| **stockStatus** | string | Cached: "AVAILABLE" \| "LOW_STOCK" \| "OUT_OF_STOCK" |
| lowStockThreshold | number | Default 20 |
| itemName, category | string | Denormalized for display |
| lastUpdated | timestamp | Used for aggregation throttle |

### inventory_shards/{itemId}/shards/{shardId}

Unchanged: `count`, `lastUpdated`. Writes are spread across shards.

---

## 3. Cloud Function Snippets

### Shard aggregation (throttled + cached)

- Throttle: if `inventory_meta.lastUpdated` is within last 3s, skip (return null).
- Compute `consumed` from shards, then `available = max(0, totalStock - consumed)`, `stockStatus = OUT_OF_STOCK | LOW_STOCK | AVAILABLE`.
- Write to `inventory_meta` with `consumed`, `available`, `stockStatus`, `lastUpdated`.

### createOrder burst protection

- Reject if `items.length > MAX_ITEMS_PER_ORDER` (25).
- Reject if any `item.quantity > MAX_QUANTITY_PER_ITEM` (10).

### serveItem

- `runWith({ memory: "512MB", maxInstances: 50 })` for better cold-start and concurrency.

### updateInventory (admin)

- When updating `inventory_meta`, also set `available` and `stockStatus` from current `consumed` / `totalStock` / `lowStockThreshold`.

---

## 4. React Hook Logic

- **listenToInventoryMeta**: Optional second argument `{ includeMetadataChanges: false }` (default) to avoid metadata-only snapshots and reduce bandwidth.
- **getStockStatus(meta)**: Prefer `meta.available` and `meta.stockStatus` when present; otherwise derive from `totalStock`, `consumed`, `lowStockThreshold`.
- **useInventory()**: Unchanged; it already uses `getStockStatus`, which now prefers cached fields.
- **useQueueEstimate(intervalMs?)**: New optional hook that polls `getQueueEstimate()` every 30s (or custom interval) and returns `{ minutes, pendingCount, loading, refresh }` for student UI.

---

## 5. Performance Recommendations

- **Throttle aggregation**: 3s throttle per item reduces trigger runs during lunch rush while keeping UI responsive.
- **Cached fields**: `available` and `stockStatus` in `inventory_meta` reduce client computation and make snapshot payloads self-contained.
- **Single collection listener**: Students subscribe only to `inventory_meta`; no per-item or shard listeners.
- **serveItem**: 512MB and higher maxInstances improve throughput; keep minInstances 0 to control cost.
- **Burst limits**: Cap line items and quantity per item to limit large orders and stock checks.

---

## 6. Scalability Analysis

- **10K+ daily users**: Order and serve traffic is spread by sharded counters; aggregation is throttled; createOrder has burst limits.
- **Lunch spikes**: Throttle prevents one hot item from causing hundreds of meta writes per minute; cached fields reduce read path work.
- **Concurrent serving**: serveItem uses a single transaction (order + serveLog + one shard increment); no single-doc hotspot for inventory.
- **Real-time UI**: One `onSnapshot(collection("inventory_meta"))` per client; Firestore scales document reads.

---

## 7. Cost Optimization Tips

- **Throttle**: Fewer trigger invocations and meta writes during peaks.
- **includeMetadataChanges: false**: Fewer snapshot events and bandwidth.
- **minInstances: 0**: No idle instances; use maxInstances to cap concurrency.
- **Indexes**: Only add indexes used by queries (orders for queue, serveLogs for daily consumption).
- **Optional scheduled aggregation**: For even lower trigger cost, you could run a scheduled function every 30–60s to recompute all `inventory_meta` from shards and disable the onWrite trigger; trade-off is up to 30–60s delay in stock updates.

---

## 8. Race Conditions

- **createOrder**: Stock is read then order is written; another order can consume stock in between (TOCTOU). Mitigation: burst limits and server-side check at create; for strict guarantees, consider a reservation schema (e.g. reserve stock in a transaction when order is created).
- **serveItem**: No race; transaction ensures validate-then-increment and order/serveLog consistency.

---

## 9. Firestore Indexes

- **orders**: Existing composite indexes on `orderStatus` + `createdAt` are sufficient for queue estimate and admin listing.
- **serveLogs**: `servedAt` (ASC) for daily consumption (already present).

---

## 10. Security Rules

- **inventory_meta**: `allow read: if isAuthenticated() && request.auth.uid != null` so only signed-in users (including students) can read; no client writes.
- No change to orders, serveLogs, scanLogs flows.
