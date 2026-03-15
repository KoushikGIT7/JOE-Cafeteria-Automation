# Zero-Wait Smart Cafeteria System

## 1. Updated Firestore schema (orders)

Orders collection is **extended** with the following fields. Existing fields are unchanged.

| Field | Type | Description |
|-------|------|-------------|
| **orderType** | string | `FAST_ITEM` \| `PREPARATION_ITEM` |
| **serveFlowStatus** | string | `PAID` \| `NEW` \| `PREPARING` \| `READY` \| `SERVED` |
| **pickupWindowStart** | timestamp | Start of pickup window (ms or Timestamp) |
| **pickupWindowEnd** | timestamp | End of pickup window |
| **estimatedReadyTime** | timestamp | When order is estimated to be ready |

- **FAST_ITEM**: Plate/rice meals (e.g. Lunch category). One item per order. Serve immediately when QR scanned (serveFlowStatus `PAID`). Do **not** show on server preparation dashboard.
- **PREPARATION_ITEM**: Kitchen items (Dosa, Uttapam, etc.). Shown on server dashboard. Flow: `NEW` → `PREPARING` → `READY` → `SERVED`. QR valid for serve only when `serveFlowStatus === READY`.

---

## 2. Cloud Function: pickup window calculation

**Name:** `updateServeFlowStatus` (callable)

When server sets status to **PREPARING**:

1. Count pending preparation orders: `orderType === 'PREPARATION_ITEM'` and `serveFlowStatus` in `['PREPARING', 'READY']`.
2. Queue delay = sum of prep times for those orders (from `PREP_TIME_BY_ITEM` or defaults).
3. This order’s prep time = sum of per-item prep times × quantity.
4. `estimatedReadyTime = now + (queueDelay + orderPrepTime)` (seconds → ms).
5. `pickupWindowStart = estimatedReadyTime`, `pickupWindowEnd = estimatedReadyTime + 2` minutes.
6. Write to order: `serveFlowStatus: 'PREPARING'`, `estimatedReadyTime`, `pickupWindowStart`, `pickupWindowEnd`.

Prep times (seconds): e.g. Masala Dosa 45, Plain Dosa 30, Uttapam 60 (configurable in constants and in Functions).

---

## 3. Cloud Function: FCM notification

When server sets status to **READY** in `updateServeFlowStatus`:

1. Update order: `serveFlowStatus: 'READY'`.
2. Read `users/{order.userId}` for `fcmToken` or `fcmTokens[0]`.
3. If token exists, send FCM message:
   - **title:** "Your order is ready for pickup"
   - **body:** "{item names} – Pickup window: HH:MM – HH:MM"
   - **data:** `{ orderId, type: 'PICKUP_READY' }`
   - Android: high priority, default sound, vibrate.
   - APNs: sound, contentAvailable.

**Client FCM registration (implemented):** On sign-in, the app calls `registerFCMToken(uid)`, which requests notification permission, gets the FCM token, and saves it to `users/{uid}.fcmToken`. Requires `VITE_FIREBASE_VAPID_KEY` in `.env` (Web Push certificate from Firebase Console → Project Settings → Cloud Messaging → Web Push certificates).

---

## 4. QR validation logic update

**validateQRCode** (callable):

- **FAST_ITEM:** Allow scan and set `qrStatus: USED`, etc., if `serveFlowStatus === 'PAID'` (or legacy: missing serveFlowStatus).
- **PREPARATION_ITEM:** Allow only if `serveFlowStatus === 'READY'`. Otherwise throw:  
  `NOT_READY - Please come at your pickup time.`

Server UI shows this message when student scans before READY.

**serveItem:** Unchanged. When all line items are served, order is marked `orderStatus: COMPLETED`, `qrState: SERVED`, and for preparation orders `serveFlowStatus: 'SERVED'`.

---

## 5. React server dashboard (Preparation)

- **Screen:** `KitchenView` (Preparation Dashboard).
- **Data:** `listenToPreparationOrders(callback, 80)` — only orders with `orderType === 'PREPARATION_ITEM'` and `serveFlowStatus` in `['NEW', 'PREPARING', 'READY']`.
- **Sections:** NEW (gray), PREPARING (amber), READY (green). Orders move between sections as server acts.
- **Actions:**
  - **Start Preparing** (ತಯಾರಿಸಲು ಪ್ರಾರಂಭಿಸಿ): NEW → PREPARING (pickup window computed in Cloud Function).
  - **Ready** (ಸಿದ್ಧವಾಗಿದೆ): PREPARING → READY (FCM sent).
  - **Serve:** Done at counter when student scans QR (no button on dashboard).
- **Bilingual:** EN / ಕನ್ toggle. Labels from `SERVER_LABELS` (constants).
- **UX:** Large buttons, color-coded sections, minimal text, clear icons.

FAST_ITEM orders do **not** appear here; they are served directly at the counter after QR scan.

---

## 6. Student UI updates (pickup windows)

- **HomeView – Active order banner:**
  - **PREPARATION_ITEM:** Show status line: "Order received…", "Being prepared. Pickup window: HH:MM – HH:MM", or "Ready for pickup. Window: HH:MM – HH:MM".
  - Subtext: "You will get a notification when your order is ready. Arrive during your pickup window." / "Pickup window: … Come to the counter and scan your QR."
- **Order type and flow** derived from `orderType`, `serveFlowStatus`, `pickupWindowStart`, `pickupWindowEnd` on the order document.

---

## 7. Firestore queries for dashboard

- **Preparation orders (server):**  
  `orders` where `orderType == 'PREPARATION_ITEM'` and `serveFlowStatus in ['NEW','PREPARING','READY']`, orderBy `createdAt` desc, limit 80.
- **Index:** Composite on `(orderType, serveFlowStatus, createdAt)`.

Existing queries for orders, serveLogs, scanLogs, and QR flow are unchanged.

---

## 8. Performance

- Single listener for preparation dashboard: one query with composite index; no per-order listeners.
- Pickup window and FCM run in one callable per transition (PREPARING / READY).
- Rate limits and burst limits on createOrder unchanged; no extra reads for FAST_ITEM at counter.

---

## 9. Security rules

- No change required for `orders`: create/update still only via Cloud Functions; clients read as before.
- Ensure `users/{uid}` is writable by the signed-in user so FCM token can be stored.

---

## 10. UI/UX layout (server dashboard)

- **Header:** Back, title "Preparation Dashboard" / "ಪ್ರಸ್ತುತಿ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್", EN | ಕನ್ toggle.
- **Sections (stacked):**
  1. **NEW:** Gray border, list of orders; each with order #, user, items, **large amber "Start Preparing"** button with icon.
  2. **PREPARING:** Amber border, same info + pickup window text; **large green "Ready"** button.
  3. **READY:** Green border, same info + pickup window; no button, text: "Waiting for student to scan QR".
- **Buttons:** Full-width, large padding, bold uppercase, icon + label (English or Kannada).
- **No FAST_ITEM** orders on this screen.
