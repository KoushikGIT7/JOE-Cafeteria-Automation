# Smart Kitchen Flow Control Layer

This document describes the **preparation slot system** and **queue flow control** for the cafeteria backend. It extends the existing orders, preparation workflow, and notifications **without redesigning** the architecture.

---

## 1. Firestore Schema for Preparation Queue Management

### preparationStations (new collection)

Config per preparation station (e.g. dosa, default). Used by Cloud Functions to enforce slot limits.

```
preparationStations/{stationId}
  - maxConcurrentPreparation: number   // e.g. 3 — only this many orders can be PREPARING at once
  - name: string                       // "Dosa Station"
  - nameKn?: string                    // "ದೋಸೆ ಸ್ಟೇಷನ್"
  - avgPrepTimeSeconds?: number        // for QUEUED estimated time (default 45)
```

- **Read:** server, admin  
- **Write:** admin  
- If a document is missing, Cloud Functions use defaults: `maxConcurrentPreparation = 3`, `avgPrepTimeSeconds = 45`.

### orders (extended fields only)

Existing fields unchanged. New optional fields for preparation flow control:

| Field | Type | Description |
|-------|------|-------------|
| `preparationStationId` | string | Station for this order (e.g. `"dosa"`, `"default"`). Set at create for PREPARATION_ITEM. |
| `queuePosition` | number | 1-based position when status is QUEUED. Cleared when moving to PREPARING. |
| `estimatedQueueStartTime` | Timestamp | When this order is expected to start preparing (QUEUED). Used for countdown. Cleared when moving to PREPARING. |

### serveFlowStatus (extended)

- **NEW** — Order just confirmed; not yet started.
- **QUEUED** — Server requested PREPARING but no slot was free; order waits. Auto-advances when a slot frees.
- **PREPARING** — Currently using a preparation slot; pickup window set.
- **READY** — Ready for pickup; FCM sent.
- **SERVED** — Picked up (set by serveItem).

Listeners and indexes already support `NEW`, `PREPARING`, `READY`; they are extended to include `QUEUED` (e.g. `in` query and composite index on `preparationStationId`, `serveFlowStatus`, `createdAt`).

---

## 2. Cloud Function Logic for Slot Management

### createOrder

- For `orderType === "PREPARATION_ITEM"`, set `preparationStationId = derivePreparationStationId(items)`.
- Mapping: item ids 3, 4, 10 → `"dosa"`; others → `"default"`. Overridable by adding docs to `preparationStations` and/or mapping in code.

### updateServeFlowStatus (callable)

**When `serveFlowStatus === "PREPARING"` (server presses “Start Preparing”):**

1. Resolve station: `stationId = order.preparationStationId || "default"`.
2. Load config: `getStationConfig(stationId)` from `preparationStations/{stationId}` or defaults.
3. Count current PREPARING for this station:  
   `orders` where `preparationStationId == stationId` and `serveFlowStatus == "PREPARING"`.
4. **If count < maxConcurrentPreparation:**
   - Set order to `PREPARING`.
   - Set `estimatedReadyTime = now + prepTimeSecondsForOrder(order.items)` (single order).
   - Set `pickupWindowStart`, `pickupWindowEnd` (e.g. start = estimatedReadyTime, end = start + 2 min).
   - Clear `queuePosition`, `estimatedQueueStartTime`.
   - Return success and slot-used.
5. **If count >= max and current status is NEW:**
   - Set order to `QUEUED`.
   - Set `queuePosition = 1 + (number of QUEUED orders for this station)`.
   - Set `estimatedQueueStartTime` and `estimatedReadyTime` using a heuristic:  
     `positionsAhead * avgPrepTimeSeconds + orderPrepSeconds` from now.
   - Return success, queued, and `queuePosition`.
6. **If count >= max and current status is QUEUED:**  
   No slot yet; return “No slot available” (order stays QUEUED).

**When `serveFlowStatus === "READY"` (server presses “Ready”):**

1. Update order to `READY`, send FCM (unchanged).
2. Call **advanceQueue(stationId)** (see below).

### advanceQueue(stationId)

1. Query one order:  
   `orders` where `preparationStationId == stationId` and `serveFlowStatus == "QUEUED"`  
   `orderBy("createdAt", "asc")`, `limit(1)`.
2. If none, return.
3. Update that order to `PREPARING`; set `estimatedReadyTime = now + prepTimeSecondsForOrder(items)`, `pickupWindowStart`, `pickupWindowEnd`; clear `queuePosition`, `estimatedQueueStartTime`.
4. Log for analytics.

This runs **automatically** when an order moves to READY, so the next queued order starts without a second button press.

---

## 3. Algorithm for Pickup Window Calculation

- **When order is set to PREPARING (slot acquired):**
  - `estimatedReadyTime = now + prepTimeSecondsForOrder(order.items)` (only this order’s prep time).
  - `pickupWindowStart = estimatedReadyTime`, `pickupWindowEnd = estimatedReadyTime + PICKUP_WINDOW_MINUTES` (e.g. 2 min).

- **When order is set to QUEUED (no slot):**
  - `positionsAhead = (current PREPARING count) + (new queue position - 1)`.
  - `estimatedQueueStartTime = now + positionsAhead * avgPrepTimeSeconds` (station config).
  - `estimatedReadyTime = estimatedQueueStartTime + prepTimeSecondsForOrder(order.items)`.
  - These are best-effort estimates for display and countdown; actual times are set when the order is advanced to PREPARING.

- **prepTimeSecondsForOrder(items):**  
  Sum over items of `(PREP_TIME_BY_ITEM[id] || default) * quantity` (existing logic).

---

## 4. Server Dashboard UI Workflow

- **Sections (in order):**
  1. **New** — NEW orders; single prominent action: “Start Preparing” (EN) / “ತಯಾರಿಸಲು ಪ್ರಾರಂಭಿಸಿ” (KN).
  2. **Queued** — QUEUED orders; show queue position and countdown to `estimatedQueueStartTime` (or “X min left”). First in list is **Next** (highlight + optional “Start Preparing” to claim slot when one frees).
  3. **Preparing** — PREPARING orders; show countdown to `estimatedReadyTime` and pickup window; action: “Ready”.
  4. **Ready for Pickup** — READY orders; no action (student scans QR at counter).

- **UX:** Large buttons, minimal text, color by state (e.g. grey/slate for Queued, amber for Preparing, green for Ready). EN | ಕನ್ toggle; labels from `SERVER_LABELS`. Timer/countdown per card where applicable.

- **Flow:**  
  Server taps “Start Preparing” on a NEW order → backend either moves it to PREPARING (slot used) or to QUEUED (slot full). When server taps “Ready” on a PREPARING order → order goes READY, FCM sent, then **advanceQueue** runs and the next QUEUED order (if any) moves to PREPARING automatically; dashboard updates via real-time listener.

---

## 5. Peak Load Safety

- **Slot cap:** `maxConcurrentPreparation` (e.g. 3) limits how many orders can be PREPARING per station at once, preventing kitchen overload.
- **Automatic advancement:** When an order becomes READY, the next QUEUED order is moved to PREPARING without another tap, keeping the queue moving and avoiding “forgotten” queued orders.
- **Queued estimates:** QUEUED orders get `estimatedQueueStartTime` and `estimatedReadyTime` so staff and (if shown) students see approximate wait; actual times are fixed when the order enters PREPARING.
- **No manual PREPARING overflow:** Backend rejects moving to PREPARING when the station is full (places or keeps order in QUEUED), so PREPARING count never exceeds the configured max.

---

## 6. Analytics Data Design

Metrics can be computed from existing data and optional writes:

- **Average preparation time per item (or order):**  
  From order lifecycle: `serveFlowUpdatedAt` when status became PREPARING vs when it became READY. Store in a small doc per order or aggregate in a scheduled job (e.g. `preparationMetrics/{date}` with `avgPrepTimeSecondsByItemId` or `avgPrepTimeSeconds`).

- **Average queue delay:**  
  Time from order creation (or from QUEUED) until `serveFlowStatus` became PREPARING. Optional: when moving order from QUEUED to PREPARING, write a log doc (e.g. `queueLogs` or a field on the order) with `queuedAt`, `preparingAt`; aggregate by day/station.

- **Peak hour order load:**  
  Existing `orders` with `createdAt`; aggregate count by hour (e.g. scheduled job writing `orderCountByHour/{date}_{hour}` or querying for dashboards).

- **Preparation station utilization:**  
  Over a time window, ratio (time with PREPARING count > 0) / (total time), or average PREPARING count / maxConcurrentPreparation. Requires either periodic sampling (scheduled job writing PREPARING count to `stationUtilization/{stationId}/{timestamp}`) or reconstructing from order timestamps (PREPARING → READY intervals).

**Recommended (minimal):**  
- Keep using existing `orders` and `serveLogs` for reporting.  
- Optional: when order moves to READY, write one doc to `preparationMetrics` or `queueLogs` with orderId, stationId, preparedAt, createdAt (and optionally queuedAt), for later aggregation.  
- Scheduled job (e.g. daily): aggregate into `preparationDailyStats/{date}` (avg prep time, avg queue delay, order count by station) for admin dashboards.

---

## 7. Scalability Considerations

- **Queries:**  
  - Slot check: one query per station (PREPARING count).  
  - advanceQueue: one query per station (oldest QUEUED, limit 1).  
  - Index: `preparationStationId` (ASC), `serveFlowStatus` (ASC), `createdAt` (ASC) for advanceQueue and for counting by status.

- **Writes:**  
  One order update per “Start Preparing” (NEW → PREPARING or NEW → QUEUED); one order update per “Ready” (PREPARING → READY) plus one update for the advanced QUEUED → PREPARING order. No hotspot on a single document; stations are sharded by `preparationStationId`.

- **Listeners:**  
  Dashboard uses a single listener for preparation orders (NEW, QUEUED, PREPARING, READY) with limit (e.g. 80); no new listeners required.

- **500+ concurrent orders:**  
  Slot limit (e.g. 3 PREPARING per station) keeps concurrent preparation work bounded. Remaining orders stay in NEW or QUEUED; advanceQueue runs once per READY and processes one order at a time, which is sufficient and avoids thundering herd.

---

## 8. Summary

| Component | Extension |
|----------|------------|
| **Schema** | `preparationStations/{id}`; `orders`: `preparationStationId`, `queuePosition`, `estimatedQueueStartTime`; `serveFlowStatus` includes QUEUED. |
| **createOrder** | Sets `preparationStationId` for PREPARATION_ITEM. |
| **updateServeFlowStatus** | PREPARING: slot check → PREPARING or QUEUED; READY: then advanceQueue(stationId). |
| **advanceQueue** | One oldest QUEUED order per station → PREPARING with pickup window. |
| **Dashboard** | New + Queued + Preparing + Ready; queue position, countdown, “Next” highlight, large buttons, EN/KN. |
| **Safety** | Max PREPARING per station; auto-advance on READY; no redesign of orders, serveLogs, scanLogs, inventory, or notifications. |

This gives a **smart kitchen flow control layer** that limits active preparation, keeps a clear queue, and optimizes pickup windows while staying within the current architecture.
