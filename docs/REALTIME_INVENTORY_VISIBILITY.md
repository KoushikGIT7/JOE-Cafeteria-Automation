# Real-Time Inventory Visibility System

This document describes the production-ready real-time stock visibility system for the cafeteria app: schema, transaction flow, performance, and security.

---

## 1. Firestore schema

### Collections

| Collection | Purpose |
|------------|--------|
| `inventory/{itemId}` | Legacy admin inventory (openingStock, consumed, itemName, category). Still updated by admin; **consumed is no longer updated on serve** (see shards). |
| `inventory_meta/{itemId}` | **Source of truth for student-facing stock.** `totalStock`, `consumed` (from shard aggregation), `lowStockThreshold`, `itemName`, `category`. Students listen here for real-time AVAILABLE / LOW_STOCK / OUT_OF_STOCK. |
| `inventory_shards/{itemId}/shards/{shardId}` | Sharded counters: `shard_0` … `shard_9`. Each doc has `count` (incremented on each serve). Writes are spread across shards to avoid a single-doc hotspot. |

### Why sharded counters?

- **Problem:** Hundreds of servers serving at once → many increments on one `inventory/{itemId}` doc → Firestore write contention and latency.
- **Solution:** On each serve we increment **one random shard** (e.g. `shard_3`) instead of the main inventory doc. So writes are spread across 10 docs per item (~10x less contention).
- **Consumed value:** A Cloud Function trigger runs on any shard write, sums all shards for that item, and writes the total to `inventory_meta.consumed`. Students and createOrder read `inventory_meta` (one doc per item), not the shards.

---

## 2. Atomic inventory update (serve flow)

When a server serves food, **serveItem** (Cloud Function) runs a single transaction:

1. **Validate order:** Order exists, payment SUCCESS, QR USED, item in order, remainingQty > 0.
2. **Validate stock:** Read `inventory_meta/{itemId}.totalStock` and sum of `inventory_shards/{itemId}/shards/*.count`. If `totalStock - consumed < 1` → throw `OUT_OF_STOCK`.
3. **Update order:** Decrement `remainingQty`, increment `servedQty`; if all items served, set order status COMPLETED and qrState SERVED.
4. **Log:** Create a `serveLogs` document (orderId, itemId, quantityServed, servedBy, servedAt).
5. **Decrement stock:** Inside the same transaction, increment **one random shard** (e.g. `shard_4`) by 1. No update to `inventory` or `inventory_meta` in the transaction (that happens in the trigger).

This prevents negative stock and keeps order + serve log + stock change atomic.

---

## 3. Order validation (createOrder)

Before creating an order, **createOrder** (Cloud Function):

- For each cart line, aggregates quantity by `itemId`.
- For each `itemId`, reads `inventory_meta/{itemId}` and checks `totalStock - consumed >= quantity`.
- If any item has insufficient stock, throws:  
  `OUT_OF_STOCK - <ItemName> is currently out of stock.`

The client (PaymentView) catches this and shows: *"Item is currently out of stock. Please remove it from your cart and try again."*

---

## 4. Real-time student UI

- **Hook:** `useInventory()` (listens to `inventory_meta` via `listenToInventoryMeta`).
- **Display:** Each menu item shows:
  - **Available (N left)** when `available > lowStockThreshold`
  - **Low Stock (N left)** when `0 < available <= lowStockThreshold`
  - **Out of Stock** when `available === 0`
- **Behaviour:** "Add Item" is disabled when out of stock; quantity cannot exceed `available`; order is blocked at checkout if any item is out of stock (enforced again by createOrder).

---

## 5. Low stock warning

- `lowStockThreshold` is stored per item in `inventory_meta` (default 20). Admin can set it via `updateInventory` (and optionally via restock/inventory UI later).
- When `available <= lowStockThreshold`, the item is shown as **LOW STOCK**; students can still add to cart up to `available`.

---

## 6. Auto-disable menu items

- When `available === 0`, the item is shown as **Out of Stock** and "Add Item" is disabled so students cannot add it to cart.

---

## 7. Admin inventory dashboard

- **Data source:** Merged view of `inventory` + `inventory_meta` (prefer meta for totalStock/consumed so numbers match shard aggregation).
- **Cards:** Out of Stock count, Low Stock count, High Demand (most consumed or top popular), Total Stocked.
- **Today’s consumption:** From `serveLogs` where `servedAt >= start of today` (aggregated by itemId).
- **Popular items:** From recent orders (aggregate item quantities).

---

## 8. Performance

- **Sharded counters:** Serve writes hit one of 10 shards per item → reduced write contention for 500+ concurrent users.
- **Minimal listeners:** Students subscribe only to `inventory_meta` (one collection, one doc per item). No per-item shard listeners.
- **Indexed queries:** createOrder uses single-doc reads for `inventory_meta`. Daily consumption uses `serveLogs` with `servedAt >= today` (indexed). Popular items use `orders` with `createdAt` desc (existing indexes).

---

## 9. Security rules

- **inventory:** Read: admin, server, cashier. Write: false (Functions only).
- **inventory_meta:** Read: any authenticated user (students can see stock). Write: false (Functions only).
- **inventory_shards:** Read: admin, server, cashier. Write: false (Functions only).

Students cannot modify inventory; servers only change stock through the serveItem transaction; admins manage stock via Cloud Functions (e.g. updateInventory).

---

## 10. Compatibility

- Existing **orders**, **serveLogs**, **scanLogs** flows are unchanged.
- **inventory** is still used for admin display and restock; `updateInventory` syncs `openingStock` (and optional `lowStockThreshold`) to `inventory_meta` so student view and createOrder see correct totalStock and threshold.
