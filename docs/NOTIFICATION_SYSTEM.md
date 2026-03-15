# Notification System: FCM, Analytics & Performance

This document describes the **order-ready and pickup-reminder notification system** for the cafeteria app: Firestore schema, client token registration, Cloud Function design, token cleanup, pickup reminders, foreground toast UI, performance optimizations, security rules, and analytics.

---

## 1. Firestore Schema for FCM Tokens

### Users (primary + multi-device)

- **`users/{uid}`**
  - `fcmToken` (string, optional): Primary device token; single read for backward compatibility.
  - `fcmTokenUpdatedAt` (Timestamp, optional): Last token update.
- **`users/{uid}/fcmTokens/{tokenId}`** (subcollection)
  - `tokenId`: Deterministic id from SHA-256(token).slice(0,20) for deduplication.
  - `token` (string): FCM device token.
  - `updatedAt` (Timestamp): Last registration time (used for cleanup).

Backend collects tokens from both `users/{uid}.fcmToken` and `users/{uid}/fcmTokens` to support **multi-device** and batch send.

### Notification logs (analytics)

- **`notificationLogs/{logId}`** (created by Cloud Functions only)
  - `orderId`, `userId`, `type` (`ORDER_READY` | `PICKUP_REMINDER`)
  - `sentAt` (Timestamp)
  - `success` (boolean): true if at least one token received the message.
  - `successCount`, `totalTokens` (numbers): For delivery rate.

Index: `type` (ASC), `sentAt` (DESC) for admin analytics queries.

### Orders (extension only)

- **`orders`**: Optional field `sentPickupReminderAt` (Timestamp) set when the scheduled pickup-reminder was sent. No change to existing fields, QR, serveLogs, or inventory.

---

## 2. Client-Side Token Registration

- **Where**: `services/fcm.ts` — `registerFCMToken(uid)`.
- **When**: Called from `onAuthStateChanged` in `services/auth.ts` after sign-in.
- **Behavior**:
  1. Check FCM support and `VITE_FIREBASE_VAPID_KEY`.
  2. Request notification permission; exit if not granted.
  3. Get FCM token via `getToken(messaging, { vapidKey })`.
  4. Write **primary**: `users/{uid}` with `fcmToken`, `fcmTokenUpdatedAt` (merge).
  5. Write **multi-device**: `users/{uid}/fcmTokens/{tokenId}` with `token`, `updatedAt` (merge). `tokenId` = async hash of token (SHA-256, 20 chars) for stable dedup.

---

## 3. Cloud Function Architecture for Sending Notifications

### ORDER_READY (when kitchen marks order READY)

- **Trigger**: Callable `updateServeFlowStatus` with `serveFlowStatus: 'READY'`.
- **Flow**:
  1. Update order: `serveFlowStatus: 'READY'`, `serveFlowUpdatedAt`.
  2. **Single read**: Load user doc once; get tokens from `user.fcmToken` + `users/{uid}/fcmTokens` subcollection (no repeated reads).
  3. Build payload (see Data Payload Structure below).
  4. **Batch send**: `admin.messaging().sendEachForMulticast({ tokens, notification, data, android, apns })` — one network call for all tokens. On failure, fallback to per-token send.
  5. **Token cleanup**: If any response indicates invalid/not-registered token, remove that token from `users/{uid}.fcmToken` and/or `users/{uid}/fcmTokens/{id}`.
  6. **Log**: One `notificationLogs` doc per invocation with `orderId`, `userId`, `type: 'ORDER_READY'`, `sentAt`, `success`, `successCount`, `totalTokens`.

### PICKUP_REMINDER (scheduled)

- **Trigger**: Pub/Sub `scheduledPickupReminder` every 2 minutes (Asia/Kolkata).
- **Query**: Orders where `orderType == 'PREPARATION_ITEM'`, `serveFlowStatus == 'READY'`, limit 50. Filter in memory for `pickupWindowStart` within next 3 minutes and `sentPickupReminderAt == null`.
- **Flow**: For each order, get tokens via `getFCMTokensForUser`, send via `sendFCMToTokens`, set `sentPickupReminderAt` on the order, log to `notificationLogs` with `type: 'PICKUP_REMINDER'`.

---

## 4. Token Cleanup Logic

- **On send**: When FCM returns `messaging/invalid-registration-token` or `messaging/registration-token-not-registered`, remove that token:
  - If it was the primary, delete `fcmToken` and `fcmTokenUpdatedAt` from `users/{uid}`.
  - Delete the corresponding doc in `users/{uid}/fcmTokens/{tokenId}`.
- **Optional scheduled cleanup**: A scheduled function can delete `fcmTokens` docs where `updatedAt` is older than e.g. 90 days to reduce storage. (Not implemented by default; add if needed.)

---

## 5. Notification Scheduling (Pickup Reminders)

- **Schedule**: `scheduledPickupReminder` runs every 2 minutes.
- **Eligibility**: Order is `PREPARATION_ITEM`, `serveFlowStatus === 'READY'`, `sentPickupReminderAt` is null, and `pickupWindowStart` is between now and now + 3 minutes.
- **Action**: Send one reminder per order; set `sentPickupReminderAt` to avoid duplicate reminders. Payload uses `type: 'PICKUP_REMINDER'` and includes `orderId`, `pickupWindowStart`, `pickupWindowEnd`, `itemNames`.

---

## 6. Foreground Message UI (In-App Toast)

- **Handler**: `onForegroundMessage` in `services/fcm.ts` parses payload and exposes `orderReady` when `data.type === 'ORDER_READY'`.
- **Provider**: `NotificationProvider` in `contexts/NotificationContext.tsx` subscribes to `onForegroundMessage` and sets toast state.
- **Toast**: `components/NotificationToast.tsx` shows:
  - **Item name** (from `orderReady.itemNames` or body).
  - **Pickup window** (e.g. `12:30 – 12:32`).
  - **Button**: “View order” → calls `onViewOrder(orderId)` (navigate to QR/order screen).
- **Integration**: `App.tsx` wraps the app with `<NotificationProvider onViewOrder={(id) => { setSelectedOrderId(id); setView('QR'); }}>` so the toast opens the order/QR view.

---

## 7. Data Payload Structure

Example FCM payload for ORDER_READY:

```json
{
  "notification": {
    "title": "Order Ready",
    "body": "Your Masala Dosa is ready for pickup"
  },
  "data": {
    "type": "ORDER_READY",
    "orderId": "12345",
    "pickupWindowStart": "12:30",
    "pickupWindowEnd": "12:32",
    "itemNames": "Masala Dosa"
  }
}
```

All `data` values must be strings for FCM. The client uses `data.type`, `data.orderId`, and pickup window strings for the foreground toast and “View order” action.

---

## 8. Performance Optimization for Peak Traffic

- **Batch FCM**: Use `sendEachForMulticast` so one HTTP call sends to all tokens for a user; fallback to single sends only on batch failure.
- **Minimal reads**: For each ORDER_READY, one read of `users/{uid}` and one read of `users/{uid}/fcmTokens`; no re-read of the order after it’s in memory.
- **Minimal queries**: Pickup reminder uses one query (orderType + serveFlowStatus, limit 50), then in-memory filter by `pickupWindowStart` and `sentPickupReminderAt`.
- **One log per send**: One `notificationLogs` document per notification event (ORDER_READY or PICKUP_REMINDER) with aggregate `successCount`/`totalTokens` to keep write count low.
- **No change** to existing orders, QR, serveLogs, scanLogs, or inventory flows.

---

## 9. Security Rule Updates

- **`users/{userId}/fcmTokens/{tokenId}`**: `read, write: if request.auth.uid == userId` so only the signed-in user can register/update/delete their tokens.
- **`notificationLogs/{logId}`**: `read: if hasRole('admin')`; `create, update, delete: false` (Cloud Functions use Admin SDK).

Existing rules for `orders`, `serveLogs`, `scanLogs`, and inventory are unchanged.

---

## 10. Notification Analytics (Admin)

Metrics that can be derived from Firestore (and optionally shown in admin dashboard):

1. **Notification delivery success rate**
   - Query: `notificationLogs` where `type == 'ORDER_READY'` and `sentAt` in date range.
   - Metric: `(documents where success == true) / total documents` or use `successCount`/`totalTokens` for token-level rate.

2. **Average pickup time after READY**
   - Use existing order data: `serveFlowUpdatedAt` (or stored `readyAt`) when status became READY, and `serveLogs` or order completion time when order was served.
   - Metric: average of (servedAt − readyAt) for PREPARATION_ITEM orders that reached READY and then SERVED.

3. **Missed pickup windows**
   - Query: orders where `orderType == 'PREPARATION_ITEM'`, `serveFlowStatus == 'READY'`, `pickupWindowEnd < now`, and order not yet SERVED (e.g. no serveLog or serveFlowStatus still READY).
   - Metric: count of such orders in a day/week.

Store these in a separate analytics collection or compute in admin dashboard from `notificationLogs`, `orders`, and `serveLogs` without changing existing collections.
