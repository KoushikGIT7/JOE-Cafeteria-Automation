/**
 * JOE Cafeteria - Cloud Functions (production backend)
 * All critical mutations run here: createOrder, confirmPayment, rejectPayment,
 * validateQRCode, serveItem, updateInventory, cancelOrder, fraudDetection.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = admin.firestore;

// --- Helpers ---
function getRole(uid) {
  return db.doc(`users/${uid}`).get().then((snap) => snap.exists ? snap.data().role : null);
}

function requireAuth(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required");
  }
  return context.auth.uid;
}

function requireRole(context, allowedRoles) {
  const uid = requireAuth(context);
  return getRole(uid).then((role) => {
    if (!role || !allowedRoles.includes(role)) {
      throw new functions.https.HttpsError("permission-denied", "Insufficient role");
    }
    return uid;
  });
}

// QR signature verification (must match client: HMAC-SHA256, base64url)
function verifyQRHash(orderId, userId, cafeteriaId, createdAt, expiresAt, providedHash) {
  const crypto = require("crypto");
  const key = process.env.QR_SECRET_KEY || "JOE_QR_SECRET_2024_SECURE_TOKEN_KEY_PRODUCTION";
  const payload = `${orderId}|${userId}|${cafeteriaId}|${createdAt}|${expiresAt}`;
  const hmac = crypto.createHmac("sha256", key).update(payload).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return hmac === providedHash;
}

const QR_EXPIRY_MINUTES = parseInt(process.env.QR_EXPIRY_MINUTES || "30", 10);
const INVENTORY_SHARD_COUNT = parseInt(process.env.INVENTORY_SHARD_COUNT || "10", 10);
const MAX_ACTIVE_ORDERS_PER_USER = 3;
const MIN_SECONDS_BETWEEN_ORDERS = 5;
const MAX_ITEMS_PER_ORDER = 25;
const MAX_QUANTITY_PER_ITEM = 10;
const FAST_ITEM_CATEGORIES = ["Lunch"];
const PICKUP_WINDOW_MINUTES = 2;
const PREP_TIME_BY_ITEM = { "3": 45, "4": 30, "10": 60, "1": 30, "2": 30, "5": 45, "6": 45, "7": 45, "8": 30, "9": 45, "13": 20, "14": 15 };
const DEFAULT_PREP_TIME_SECONDS = 45;
const STATION_ID_BY_ITEM_ID = { "3": "dosa", "4": "dosa", "10": "dosa" };
const DEFAULT_STATION_ID = "default";
const DEFAULT_MAX_CONCURRENT_PREPARATION = 3;
const DEFAULT_AVG_PREP_SECONDS = 45;

function deriveOrderType(items) {
  if (!items || items.length === 0) return "PREPARATION_ITEM";
  const allFast = items.every((it) => FAST_ITEM_CATEGORIES.includes((it.category || "").trim()));
  return allFast ? "FAST_ITEM" : "PREPARATION_ITEM";
}

function derivePreparationStationId(items) {
  if (!items || items.length === 0) return DEFAULT_STATION_ID;
  const firstId = String((items[0] && items[0].id) || "").trim();
  return STATION_ID_BY_ITEM_ID[firstId] || DEFAULT_STATION_ID;
}

async function getStationConfig(stationId) {
  const snap = await db.collection("preparationStations").doc(stationId).get();
  if (snap.exists) {
    const d = snap.data();
    return { maxConcurrentPreparation: d.maxConcurrentPreparation ?? DEFAULT_MAX_CONCURRENT_PREPARATION, avgPrepTimeSeconds: d.avgPrepTimeSeconds ?? DEFAULT_AVG_PREP_SECONDS };
  }
  return { maxConcurrentPreparation: DEFAULT_MAX_CONCURRENT_PREPARATION, avgPrepTimeSeconds: DEFAULT_AVG_PREP_SECONDS };
}

// --- createOrder (authenticated or guest via data.userId) ---
exports.createOrder = functions
  .runWith({ timeoutSeconds: 30, memory: "512MB", minInstances: 2, maxInstances: 50 })
  .https.onCall(async (data, context) => {
    const uid = context.auth ? context.auth.uid : null;
    const guestId = data.userId && String(data.userId).startsWith("guest_") ? data.userId : null;
    if (!uid && !guestId) {
      throw new functions.https.HttpsError("unauthenticated", "Authentication or guest userId required");
    }
    const { items, totalAmount, paymentType, userName, cafeteriaId } = data;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new functions.https.HttpsError("invalid-argument", "items required");
    }
    const now = Date.now();
    const userId = guestId || data.userId || uid;

    const settingsSnap = await db.collection("settings").doc("global").get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    if (settings.orderingEnabled === false) {
      throw new functions.https.HttpsError("failed-precondition", "ORDERING_DISABLED - Ordering is temporarily disabled.");
    }

    // Burst protection: limit line items and quantity per item
    if (items.length > MAX_ITEMS_PER_ORDER) {
      throw new functions.https.HttpsError("invalid-argument", "BURST_LIMIT - Maximum " + MAX_ITEMS_PER_ORDER + " different items per order.");
    }

    const idempotencyKey = data.idempotencyKey || null;

    // Use a transaction for atomic stock check and order creation
    const result = await db.runTransaction(async (transaction) => {
      // 1. Idempotency check
      if (idempotencyKey) {
        const idempSnap = await transaction.get(db.collection("orders").where("idempotencyKey", "==", idempotencyKey).limit(1));
        if (!idempSnap.empty) {
          return { orderId: idempSnap.docs[0].id, duplicate: true };
        }
      }

      // 2. Stock check & prep items
      const qtyByItem = {};
      items.forEach((it) => {
        const id = it.id;
        qtyByItem[id] = (qtyByItem[id] || 0) + (it.quantity || 1);
        if ((it.quantity || 1) > MAX_QUANTITY_PER_ITEM) {
          throw new functions.https.HttpsError("invalid-argument", "BURST_LIMIT - Maximum " + MAX_QUANTITY_PER_ITEM + " per item.");
        }
      });

      for (const itemId of Object.keys(qtyByItem)) {
        const metaRef = db.collection("inventory_meta").doc(itemId);
        const metaSnap = await transaction.get(metaRef);
        if (metaSnap.exists) {
          const d = metaSnap.data();
          const available = (d.totalStock ?? 0) - (d.consumed ?? 0);
          if (available < qtyByItem[itemId]) {
            throw new functions.https.HttpsError("failed-precondition", "OUT_OF_STOCK - " + (d.itemName || itemId));
          }
        }
      }

      // 3. Create order object
      const orderId = `order_${now}_${Math.random().toString(36).slice(2, 9)}`;
      const createdAt = admin.firestore.Timestamp.fromMillis(now);
      const itemsWithQty = items.map((item) => ({
        id: item.id,
        name: item.name || "",
        price: item.price || 0,
        costPrice: item.costPrice,
        category: item.category,
        imageUrl: item.imageUrl,
        quantity: item.quantity || 1,
        servedQty: 0,
        remainingQty: item.quantity || 1,
      }));
      
      const paymentStatus = data.paymentStatus || "PENDING";
      const orderStatus = "PENDING";
      const orderType = deriveOrderType(items);
      const qrStatus = paymentType === "CASH" ? "PENDING_PAYMENT" : (paymentStatus === "SUCCESS" ? "ACTIVE" : "PENDING_PAYMENT");
      const serveFlowStatus = orderType === "FAST_ITEM" && paymentStatus === "SUCCESS" ? "PAID" : orderType === "PREPARATION_ITEM" ? "NEW" : "PAID";

      const orderDoc = {
        orderId,
        userId,
        userName: userName || "Guest",
        items: itemsWithQty,
        totalAmount: totalAmount || 0,
        paymentType: paymentType || "CASH",
        paymentStatus,
        orderStatus,
        qrStatus,
        qrState: "ACTIVE",
        qr: null,
        kitchenStatus: "PLACED",
        cafeteriaId: cafeteriaId || "main",
        createdAt,
        orderType,
        serveFlowStatus: orderType === "FAST_ITEM" && paymentStatus !== "SUCCESS" ? null : serveFlowStatus,
        preparationStationId: orderType === "PREPARATION_ITEM" ? derivePreparationStationId(items) : null,
        idempotencyKey: idempotencyKey,
      };

      transaction.set(db.collection("orders").doc(orderId), orderDoc);

      // 4. Update Inventory Shards (Atomic decrement)
      for (const itemId of Object.keys(qtyByItem)) {
        const shardIndex = Math.floor(Math.random() * INVENTORY_SHARD_COUNT);
        const shardRef = db.collection("inventory_shards").doc(itemId).collection("shards").doc(`shard_${shardIndex}`);
        transaction.set(shardRef, { 
          count: admin.firestore.FieldValue.increment(qtyByItem[itemId]),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      return { orderId };
    });

    return result;


    if (!guestId && uid) {
      const fiveSecAgo = admin.firestore.Timestamp.fromMillis(now - MIN_SECONDS_BETWEEN_ORDERS * 1000);
      const recent = await db.collection("orders").where("userId", "==", userId).where("createdAt", ">=", fiveSecAgo).limit(1).get();
      if (!recent.empty) {
        throw new functions.https.HttpsError("resource-exhausted", "RATE_LIMIT - Please wait at least 5 seconds between orders.");
      }
      const activeSnapshot = await db.collection("orders")
        .where("userId", "==", userId)
        .where("orderStatus", "in", ["PENDING", "ACTIVE"])
        .get();
      const activeCount = activeSnapshot.docs.filter((d) => {
        const o = d.data();
        return o.paymentStatus !== "REJECTED" && o.orderStatus !== "CANCELLED";
      }).length;
      if (activeCount >= MAX_ACTIVE_ORDERS_PER_USER) {
        throw new functions.https.HttpsError("resource-exhausted", "MAX_ACTIVE_ORDERS - You can have at most 3 active orders. Complete or cancel one first.");
      }
    }

    const orderId = `order_${now}_${Math.random().toString(36).slice(2, 9)}`;
    const createdAt = admin.firestore.Timestamp.fromMillis(now);
    const itemsWithQty = items.map((item) => ({
      id: item.id,
      name: item.name || "",
      price: item.price || 0,
      costPrice: item.costPrice,
      category: item.category,
      imageUrl: item.imageUrl,
      quantity: item.quantity || 1,
      servedQty: 0,
      remainingQty: item.quantity || 1,
    }));
    const paymentStatus = data.paymentStatus || "PENDING";
    const orderStatus = "PENDING";
    const qrStatus = paymentType === "CASH" ? "PENDING_PAYMENT" : (paymentStatus === "SUCCESS" ? "ACTIVE" : "PENDING_PAYMENT");
    const orderType = deriveOrderType(items);
    if (orderType === "FAST_ITEM" && items.length > 1) {
      throw new functions.https.HttpsError("invalid-argument", "FAST_ITEM - Only one meal allowed per order for plate/rice meals.");
    }
    const serveFlowStatus = orderType === "FAST_ITEM" && paymentStatus === "SUCCESS" ? "PAID" : orderType === "PREPARATION_ITEM" ? "NEW" : "PAID";
    const orderDoc = {
      orderId,
      userId,
      userName: userName || "Guest",
      items: itemsWithQty,
      totalAmount: totalAmount || 0,
      paymentType: paymentType || "CASH",
      paymentStatus,
      orderStatus,
      qrStatus,
      qrState: "ACTIVE",
      qr: null,
      kitchenStatus: "PLACED",
      cafeteriaId: cafeteriaId || "main",
      createdAt,
      scannedAt: null,
      servedAt: null,
      confirmedBy: null,
      confirmedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      orderType,
      serveFlowStatus: orderType === "FAST_ITEM" && paymentStatus !== "SUCCESS" ? null : serveFlowStatus,
      preparationStationId: orderType === "PREPARATION_ITEM" ? derivePreparationStationId(items) : null,
    };
    await db.collection("orders").doc(orderId).set(orderDoc);
    return { orderId };
  });

// --- confirmPayment (cashier) ---
exports.confirmPayment = functions
  .runWith({ timeoutSeconds: 20, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const uid = await requireRole(context, ["cashier", "admin"]);
    const { orderId } = data;
    if (!orderId) throw new functions.https.HttpsError("invalid-argument", "orderId required");
    const orderRef = db.collection("orders").doc(orderId);
    const crypto = require("crypto");
    const key = process.env.QR_SECRET_KEY || "JOE_QR_SECRET_2024_SECURE_TOKEN_KEY_PRODUCTION";
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) throw new functions.https.HttpsError("not-found", "Order not found");
      const order = snap.data();
      if (order.paymentStatus === "SUCCESS") {
        return; // idempotent
      }
      const createdAtMs = order.createdAt && order.createdAt.toMillis ? order.createdAt.toMillis() : Date.now();
      const expiresAt = createdAtMs + QR_EXPIRY_MINUTES * 60 * 1000;
      const payload = `${orderId}|${order.userId}|${order.cafeteriaId || "main"}|${createdAtMs}|${expiresAt}`;
      const tokenHash = crypto.createHmac("sha256", key).update(payload).digest("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const qrToken = JSON.stringify({
        orderId,
        userId: order.userId,
        cafeteriaId: order.cafeteriaId || "main",
        secureHash: tokenHash,
        expiresAt,
        createdAt: createdAtMs,
      });
      const orderType = order.orderType || deriveOrderType(order.items || []);
      const serveFlowStatus = orderType === "FAST_ITEM" ? "PAID" : "NEW";
      tx.update(orderRef, {
        paymentStatus: "SUCCESS",
        qrStatus: "ACTIVE",
        qrState: "ACTIVE",
        qrExpiresAt: admin.firestore.Timestamp.fromMillis(expiresAt),
        qr: {
          token: qrToken,
          status: "ACTIVE",
          createdAt: admin.firestore.Timestamp.fromMillis(createdAtMs),
        },
        confirmedBy: uid,
        confirmedAt: FieldValue.serverTimestamp(),
        orderType,
        serveFlowStatus,
      });
    });
    return { success: true, orderId };
  });

// --- rejectPayment (cashier) ---
exports.rejectPayment = functions
  .runWith({ timeoutSeconds: 15, memory: "256MB" })
  .https.onCall(async (data, context) => {
    await requireRole(context, ["cashier", "admin"]);
    const { orderId } = data;
    if (!orderId) throw new functions.https.HttpsError("invalid-argument", "orderId required");
    const orderRef = db.collection("orders").doc(orderId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) throw new functions.https.HttpsError("not-found", "Order not found");
      if (snap.data().paymentStatus !== "PENDING") {
        throw new functions.https.HttpsError("failed-precondition", "ALREADY_PROCESSED");
      }
      tx.update(orderRef, {
        paymentStatus: "REJECTED",
        orderStatus: "CANCELLED",
        rejectedAt: FieldValue.serverTimestamp(),
        rejectedBy: context.auth.uid,
        qrStatus: "REJECTED",
      });
    });
    return { success: true, orderId };
  });

// --- validateQRCode (server) ---
exports.validateQRCode = functions
  .runWith({ timeoutSeconds: 20, memory: "256MB" })
  .https.onCall(async (data, context) => {
    requireAuth(context);
    let payload;
    try {
      const raw = typeof data.qrPayload === "string" ? data.qrPayload : JSON.stringify(data.qrPayload || data);
      payload = JSON.parse(raw);
    } catch (e) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid Token Format - Cannot parse QR data");
    }
    const { orderId, userId, cafeteriaId, secureHash, expiresAt, createdAt } = payload;
    if (!orderId || !userId || !cafeteriaId || !secureHash) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid Token Format - Missing required fields");
    }
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Order not found: ${orderId}`);
    }
    const order = orderSnap.data();
    const orderCreatedAt = order.createdAt && order.createdAt.toMillis ? order.createdAt.toMillis() : Date.now();
    const qrCreatedAt = createdAt || orderCreatedAt;
    const orderExpiresAt = order.qrExpiresAt && order.qrExpiresAt.toMillis ? order.qrExpiresAt.toMillis() : null;
    const qrExpiresAt = expiresAt || orderExpiresAt || qrCreatedAt + QR_EXPIRY_MINUTES * 60 * 1000;
    if (Date.now() > qrExpiresAt) {
      await db.collection("fraudLogs").add({
        orderId,
        userId: order.userId,
        reason: "expired_qr",
        details: { qrExpiresAt, scannedAt: Date.now() },
        createdAt: FieldValue.serverTimestamp(),
      });
      functions.logger.warn("Expired QR scan attempt", { orderId, userId: order.userId });
      throw new functions.https.HttpsError("failed-precondition", "QR_CODE_EXPIRED - This QR code has expired.");
    }
    if (expiresAt && Date.now() > expiresAt) {
      throw new functions.https.HttpsError("failed-precondition", "QR_CODE_EXPIRED - This QR code has expired.");
    }
    if (!verifyQRHash(orderId, userId, cafeteriaId, qrCreatedAt, qrExpiresAt, secureHash)) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid Token Signature - Hash verification failed");
    }
    if (order.paymentStatus !== "SUCCESS") {
      throw new functions.https.HttpsError("failed-precondition", "PAYMENT_NOT_VERIFIED");
    }
    if (order.qrStatus === "USED" || order.qrState === "SCANNED" || order.qrState === "SERVED") {
      await db.collection("fraudLogs").add({
        orderId,
        userId: order.userId,
        reason: "duplicate_scan",
        details: { qrState: order.qrState },
        createdAt: FieldValue.serverTimestamp(),
      });
      functions.logger.warn("Duplicate QR scan attempt", { orderId });
      throw new functions.https.HttpsError("failed-precondition", "TOKEN_ALREADY_USED - This QR code has already been scanned.");
    }
    if (order.qrStatus !== "ACTIVE") {
      throw new functions.https.HttpsError("failed-precondition", "QR_NOT_ACTIVE");
    }
    const orderType = order.orderType || "PREPARATION_ITEM";
    if (orderType === "PREPARATION_ITEM" && order.serveFlowStatus !== "READY") {
      throw new functions.https.HttpsError("failed-precondition", "NOT_READY - Please come at your pickup time.");
    }
    if (orderType === "FAST_ITEM" && order.serveFlowStatus !== "PAID" && order.serveFlowStatus != null) {
      throw new functions.https.HttpsError("failed-precondition", "Order not ready for serve.");
    }
    const itemsWithQty = (order.items || []).map((it) => ({
      ...it,
      servedQty: it.servedQty || 0,
      remainingQty: it.remainingQty !== undefined ? it.remainingQty : (it.quantity || 0),
    }));
    await db.runTransaction(async (tx) => {
      tx.update(orderRef, {
        qrStatus: "USED",
        qrState: "SCANNED",
        qrScannedAt: FieldValue.serverTimestamp(),
        orderStatus: "ACTIVE",
        scannedAt: FieldValue.serverTimestamp(),
        items: itemsWithQty.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          costPrice: item.costPrice,
          category: item.category,
          imageUrl: item.imageUrl,
          quantity: item.quantity,
          servedQty: item.servedQty,
          remainingQty: item.remainingQty,
        })),
      });
      tx.set(db.collection("scanLogs").doc(), {
        orderId,
        userId: order.userId,
        userName: order.userName || "",
        scannedBy: context.auth?.uid || "server",
        scanTime: FieldValue.serverTimestamp(),
        scanResult: "SUCCESS",
        totalAmount: order.totalAmount || 0,
      });
    });
    return {
      success: true,
      order: {
        id: orderId,
        userId: order.userId,
        userName: order.userName,
        items: itemsWithQty,
        totalAmount: order.totalAmount,
        orderStatus: "ACTIVE",
        qrStatus: "USED",
      },
    };
  });

// --- serveItem (server): atomic validate stock, update order + serveLog, decrement via shard only ---
exports.serveItem = functions
  .runWith({ timeoutSeconds: 20, memory: "512MB", minInstances: 0, maxInstances: 50 })
  .https.onCall(async (data, context) => {
    const uid = await requireRole(context, ["server", "admin"]);
    const { orderId, itemId, servedBy } = data;
    if (!orderId || !itemId) throw new functions.https.HttpsError("invalid-argument", "orderId and itemId required");
    const orderRef = db.collection("orders").doc(orderId);
    const serveLogsRef = db.collection("serveLogs");
    const metaRef = db.collection("inventory_meta").doc(itemId);
    const shardsRef = db.collection("inventory_shards").doc(itemId).collection("shards");
    await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new functions.https.HttpsError("not-found", "Order not found");
      const orderData = orderSnap.data();
      if (orderData.paymentStatus !== "SUCCESS" || orderData.qrStatus !== "USED") {
        throw new functions.https.HttpsError("failed-precondition", "Invalid order state for serving");
      }
      const items = (orderData.items || []).map((i) => ({ ...i }));
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx === -1) throw new functions.https.HttpsError("not-found", "Item not found in order");
      if ((items[idx].remainingQty || items[idx].quantity || 0) <= 0) {
        throw new functions.https.HttpsError("failed-precondition", "Item already fully served");
      }
      // 1. Validate stock: read inventory_meta.totalStock and sum(shards)
      const metaSnap = await tx.get(metaRef);
      const totalStock = metaSnap.exists && metaSnap.data().totalStock != null ? metaSnap.data().totalStock : 0;
      const shardsSnap = await tx.get(shardsRef);
      let consumed = 0;
      shardsSnap.docs.forEach((d) => { consumed += d.data().count || 0; });
      if (totalStock - consumed < 1) {
        throw new functions.https.HttpsError("failed-precondition", "OUT_OF_STOCK - No stock left for this item.");
      }
      // 2. Update order + serveLog
      items[idx].servedQty = (items[idx].servedQty || 0) + 1;
      items[idx].remainingQty = (items[idx].remainingQty ?? items[idx].quantity ?? 0) - 1;
      const allServed = items.every((i) => (i.remainingQty || 0) <= 0);
      const update = {
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          costPrice: item.costPrice,
          category: item.category,
          imageUrl: item.imageUrl,
          quantity: item.quantity,
          servedQty: item.servedQty || 0,
          remainingQty: item.remainingQty !== undefined ? item.remainingQty : item.quantity,
        })),
        orderStatus: allServed ? "COMPLETED" : orderData.orderStatus,
        servedAt: allServed ? FieldValue.serverTimestamp() : orderData.servedAt,
        qrState: allServed ? "SERVED" : (orderData.qrState || "SCANNED"),
      };
      if (orderData.orderType === "PREPARATION_ITEM" && allServed) {
        update.serveFlowStatus = "SERVED";
      }
      tx.update(orderRef, update);
      tx.set(serveLogsRef.doc(), {
        orderId,
        itemId,
        itemName: items[idx].name,
        quantityServed: 1,
        servedBy: servedBy || uid,
        servedAt: FieldValue.serverTimestamp(),
      });
      // 3. Decrement stock via one shard (distributed write; no single-doc hotspot)
      const shardIndex = Math.floor(Math.random() * INVENTORY_SHARD_COUNT);
      const shardRef = shardsRef.doc(`shard_${shardIndex}`);
      tx.set(shardRef, { count: FieldValue.increment(1), lastUpdated: FieldValue.serverTimestamp() }, { merge: true });
    });
    return { success: true };
  });

// --- updateInventory (admin): updates inventory + inventory_meta for real-time student view ---
const DEFAULT_LOW_STOCK_THRESHOLD = 20;
exports.updateInventory = functions
  .runWith({ timeoutSeconds: 15, memory: "256MB" })
  .https.onCall(async (data, context) => {
    await requireRole(context, ["admin"]);
    const { itemId, itemName, openingStock, consumed, category, lowStockThreshold } = data;
    if (!itemId) throw new functions.https.HttpsError("invalid-argument", "itemId required");
    const invRef = db.collection("inventory").doc(itemId);
    const metaRef = db.collection("inventory_meta").doc(itemId);
    const snap = await invRef.get();
    const updates = { lastUpdated: FieldValue.serverTimestamp() };
    if (itemName !== undefined) updates.itemName = itemName;
    if (openingStock !== undefined) updates.openingStock = openingStock;
    if (consumed !== undefined) updates.consumed = consumed;
    if (category !== undefined) updates.category = category;
    if (snap.exists) {
      await invRef.update(updates);
    } else {
      await invRef.set({
        itemId,
        itemName: itemName || "",
        openingStock: openingStock ?? 0,
        consumed: consumed ?? 0,
        category: category || "",
        ...updates,
      });
    }
    // Keep inventory_meta in sync: totalStock, cached available/stockStatus for student real-time view
    const metaSnap = await metaRef.get();
    const metaData = metaSnap.exists ? metaSnap.data() : {};
    const totalStock = openingStock !== undefined ? openingStock : (metaData.totalStock ?? 0);
    const threshold = lowStockThreshold !== undefined ? lowStockThreshold : (metaData.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
    const consumedVal = metaSnap.exists ? (metaData.consumed ?? 0) : 0;
    const available = Math.max(0, totalStock - consumedVal);
    const stockStatus = available <= 0 ? "OUT_OF_STOCK" : available <= threshold ? "LOW_STOCK" : "AVAILABLE";
    await metaRef.set({
      totalStock,
      lowStockThreshold: threshold,
      consumed: consumedVal,
      available,
      stockStatus,
      itemName: itemName !== undefined ? itemName : (metaData.itemName || ""),
      category: category !== undefined ? category : (metaData.category || ""),
      lastUpdated: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { success: true };
  });

// --- cancelOrder ---
exports.cancelOrder = functions
  .runWith({ timeoutSeconds: 15, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    const { orderId } = data;
    if (!orderId) throw new functions.https.HttpsError("invalid-argument", "orderId required");
    const orderRef = db.collection("orders").doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Order not found");
    const order = snap.data();
    if (order.userId !== uid) {
      const role = await getRole(uid);
      if (role !== "admin" && role !== "cashier") {
        throw new functions.https.HttpsError("permission-denied", "Cannot cancel this order");
      }
    }
    if (order.orderStatus === "COMPLETED" || order.paymentStatus === "SUCCESS") {
      throw new functions.https.HttpsError("failed-precondition", "Order cannot be cancelled in current state");
    }
    await orderRef.update({
      orderStatus: "CANCELLED",
      paymentStatus: order.paymentStatus === "PENDING" ? "REJECTED" : order.paymentStatus,
      rejectedAt: FieldValue.serverTimestamp(),
      rejectedBy: uid,
      qrStatus: "REJECTED",
    });
    return { success: true };
  });

// --- updateKitchenStatus (server / admin) ---
exports.updateKitchenStatus = functions
  .runWith({ timeoutSeconds: 15, memory: "256MB" })
  .https.onCall(async (data, context) => {
    await requireRole(context, ["server", "admin"]);
    const { orderId, kitchenStatus } = data;
    if (!orderId || !kitchenStatus) throw new functions.https.HttpsError("invalid-argument", "orderId and kitchenStatus required");
    const valid = ["PLACED", "COOKING", "READY", "SERVED"];
    if (!valid.includes(kitchenStatus)) throw new functions.https.HttpsError("invalid-argument", "kitchenStatus must be PLACED, COOKING, READY, or SERVED");
    const orderRef = db.collection("orders").doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Order not found");
    await orderRef.update({ kitchenStatus, kitchenUpdatedAt: FieldValue.serverTimestamp() });
    return { success: true };
  });

// --- FCM helpers: batch send, notificationLogs, token cleanup ---
async function getFCMTokensForUser(uid) {
  const tokens = [];
  const userDoc = await db.collection("users").doc(uid).get();
  if (userDoc.exists && userDoc.data().fcmToken) tokens.push(userDoc.data().fcmToken);
  const tokensSnap = await db.collection("users").doc(uid).collection("fcmTokens").get();
  tokensSnap.docs.forEach((d) => {
    const t = d.data().token;
    if (t && !tokens.includes(t)) tokens.push(t);
  });
  return tokens;
}

async function sendFCMToTokens(tokens, notification, data, logContext) {
  if (tokens.length === 0) return { successCount: 0, invalidTokens: [] };
  const dataStr = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
  const invalidTokens = [];
  let successCount = 0;
  const logsRef = db.collection("notificationLogs");
  const message = {
    notification,
    data: dataStr,
    android: { priority: "high", notification: { sound: "default", defaultVibrateTimings: true } },
    apns: { payload: { aps: { sound: "default", contentAvailable: true } } },
  };
  try {
    const response = await admin.messaging().sendEachForMulticast({ tokens, ...message });
    response.responses.forEach((r, i) => {
      if (r.success) {
        successCount++;
      } else {
        const isInvalid = r.error && (r.error.code === "messaging/invalid-registration-token" || r.error.code === "messaging/registration-token-not-registered");
        if (isInvalid) invalidTokens.push(tokens[i]);
      }
    });
  } catch (e) {
    functions.logger.warn("sendEachForMulticast failed, falling back to single sends", e);
    for (const token of tokens) {
      try {
        await admin.messaging().send({ token, ...message });
        successCount++;
      } catch (err) {
        const isInvalid = err.code === "messaging/invalid-registration-token" || err.code === "messaging/registration-token-not-registered";
        if (isInvalid) invalidTokens.push(token);
      }
    }
  }
  const batch = db.batch();
  batch.set(logsRef.doc(), {
    ...logContext,
    type: logContext.type || "ORDER_READY",
    sentAt: FieldValue.serverTimestamp(),
    success: successCount > 0,
    successCount,
    totalTokens: tokens.length,
  });
  try {
    await batch.commit();
  } catch (e) {
    functions.logger.warn("notificationLogs write failed", e);
  }
  return { successCount, invalidTokens };
}

async function removeFCMTokens(uid, tokensToRemove) {
  if (tokensToRemove.length === 0) return;
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  const primary = userDoc.exists ? userDoc.data().fcmToken : null;
  if (primary && tokensToRemove.includes(primary)) {
    await userRef.update({ fcmToken: FieldValue.delete(), fcmTokenUpdatedAt: FieldValue.delete() });
  }
  const tokensSnap = await db.collection("users").doc(uid).collection("fcmTokens").get();
  for (const docSnap of tokensSnap.docs) {
    const t = docSnap.data().token;
    if (t && tokensToRemove.includes(t)) {
      await docSnap.ref.delete();
    }
  }
}

// --- updateServeFlowStatus (server): NEW→PREPARING (sets pickup window), PREPARING→READY (sends FCM) ---
function prepTimeSecondsForOrder(items) {
  let total = 0;
  (items || []).forEach((it) => {
    const id = String(it.id || "").trim();
    const name = (it.name || "").toLowerCase();
    let sec = PREP_TIME_BY_ITEM[id];
    if (sec == null) {
      if (name.includes("dosa") && !name.includes("masala")) sec = 30;
      else if (name.includes("uttapam")) sec = 60;
      else if (name.includes("masala dosa")) sec = 45;
      else sec = DEFAULT_PREP_TIME_SECONDS;
    }
    total += sec * (it.quantity || 1);
  });
  return total;
}

exports.updateServeFlowStatus = functions
  .runWith({ timeoutSeconds: 25, memory: "256MB" })
  .https.onCall(async (data, context) => {
    await requireRole(context, ["server", "admin"]);
    const { orderId, serveFlowStatus: newStatus } = data;
    if (!orderId || !newStatus) throw new functions.https.HttpsError("invalid-argument", "orderId and serveFlowStatus required");
    if (!["PREPARING", "READY"].includes(newStatus)) throw new functions.https.HttpsError("invalid-argument", "serveFlowStatus must be PREPARING or READY");
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new functions.https.HttpsError("not-found", "Order not found");
    const order = orderSnap.data();
    if (order.orderType !== "PREPARATION_ITEM") throw new functions.https.HttpsError("failed-precondition", "Only preparation orders can use this flow");
    const current = order.serveFlowStatus || "NEW";
    if (newStatus === "PREPARING" && current !== "NEW" && current !== "QUEUED") throw new functions.https.HttpsError("failed-precondition", "Order already in progress");
    if (newStatus === "READY" && current !== "PREPARING") throw new functions.https.HttpsError("failed-precondition", "Order must be PREPARING before READY");

    const stationId = order.preparationStationId || DEFAULT_STATION_ID;

    if (newStatus === "PREPARING") {
      const stationConfig = await getStationConfig(stationId);
      const preparingSnap = await db.collection("orders")
        .where("preparationStationId", "==", stationId)
        .where("serveFlowStatus", "==", "PREPARING")
        .get();
      const preparingCount = preparingSnap.size;
      const now = Date.now();
      const orderPrepSeconds = prepTimeSecondsForOrder(order.items);

      if (preparingCount < stationConfig.maxConcurrentPreparation) {
        const estimatedReadyTime = now + orderPrepSeconds * 1000;
        const pickupWindowEnd = estimatedReadyTime + PICKUP_WINDOW_MINUTES * 60 * 1000;
        await orderRef.update({
          serveFlowStatus: "PREPARING",
          estimatedReadyTime: admin.firestore.Timestamp.fromMillis(estimatedReadyTime),
          pickupWindowStart: admin.firestore.Timestamp.fromMillis(estimatedReadyTime),
          pickupWindowEnd: admin.firestore.Timestamp.fromMillis(pickupWindowEnd),
          serveFlowUpdatedAt: FieldValue.serverTimestamp(),
          queuePosition: FieldValue.delete(),
          estimatedQueueStartTime: FieldValue.delete(),
        });
        return { success: true, slotUsed: true, estimatedReadyTime, pickupWindowEnd };
      }

      if (current === "NEW") {
        const queuedSnap = await db.collection("orders")
          .where("preparationStationId", "==", stationId)
          .where("serveFlowStatus", "==", "QUEUED")
          .get();
        const queuePosition = queuedSnap.size + 1;
        const positionsAhead = preparingCount + queuePosition - 1;
        const estimatedQueueStartMs = now + positionsAhead * stationConfig.avgPrepTimeSeconds * 1000;
        const estimatedReadyTime = estimatedQueueStartMs + orderPrepSeconds * 1000;
        await orderRef.update({
          serveFlowStatus: "QUEUED",
          queuePosition,
          estimatedQueueStartTime: admin.firestore.Timestamp.fromMillis(estimatedQueueStartMs),
          estimatedReadyTime: admin.firestore.Timestamp.fromMillis(estimatedReadyTime),
          serveFlowUpdatedAt: FieldValue.serverTimestamp(),
        });
        return { success: true, slotUsed: false, queued: true, queuePosition, estimatedReadyTime };
      }
      return { success: false, slotUsed: false, message: "No slot available; order remains in queue." };
    }

    if (newStatus === "READY") {
      const readyAt = FieldValue.serverTimestamp();
      await orderRef.update({
        serveFlowStatus: "READY",
        serveFlowUpdatedAt: readyAt,
      });
      const pickupStart = order.pickupWindowStart && order.pickupWindowStart.toMillis ? order.pickupWindowStart.toMillis() : Date.now();
      const pickupEnd = order.pickupWindowEnd && order.pickupWindowEnd.toMillis ? order.pickupWindowEnd.toMillis() : Date.now() + 2 * 60 * 1000;
      const itemNames = (order.items || []).map((i) => i.name).filter(Boolean).join(", ");
      const fmt = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
      const pickupStartStr = fmt(pickupStart);
      const pickupEndStr = fmt(pickupEnd);
      const body = `Pickup window: ${pickupStartStr} – ${pickupEndStr}`;
      const tokens = await getFCMTokensForUser(order.userId);
      const notification = {
        title: "Order Ready",
        body: itemNames ? `Your ${itemNames} is ready for pickup` : "Your order is ready for pickup",
      };
      const data = {
        type: "ORDER_READY",
        orderId,
        pickupWindowStart: pickupStartStr,
        pickupWindowEnd: pickupEndStr,
        itemNames: itemNames || "",
      };
      const { successCount, invalidTokens } = await sendFCMToTokens(tokens, notification, data, {
        orderId,
        userId: order.userId,
        type: "ORDER_READY",
      });
      if (invalidTokens.length > 0) {
        await removeFCMTokens(order.userId, invalidTokens);
      }
      functions.logger.info("ORDER_READY notification", { orderId, userId: order.userId, sent: successCount, invalid: invalidTokens.length });
      await advanceQueue(stationId);
      return { success: true };
    }
    return { success: true };
  });

async function advanceQueue(stationId) {
  const nextSnap = await db.collection("orders")
    .where("preparationStationId", "==", stationId)
    .where("serveFlowStatus", "==", "QUEUED")
    .orderBy("createdAt", "asc")
    .limit(1)
    .get();
  if (nextSnap.empty) return;
  const nextDoc = nextSnap.docs[0];
  const nextOrder = nextDoc.data();
  const now = Date.now();
  const orderPrepSeconds = prepTimeSecondsForOrder(nextOrder.items);
  const estimatedReadyTime = now + orderPrepSeconds * 1000;
  const pickupWindowEnd = estimatedReadyTime + PICKUP_WINDOW_MINUTES * 60 * 1000;
  await nextDoc.ref.update({
    serveFlowStatus: "PREPARING",
    estimatedReadyTime: admin.firestore.Timestamp.fromMillis(estimatedReadyTime),
    pickupWindowStart: admin.firestore.Timestamp.fromMillis(estimatedReadyTime),
    pickupWindowEnd: admin.firestore.Timestamp.fromMillis(pickupWindowEnd),
    serveFlowUpdatedAt: FieldValue.serverTimestamp(),
    queuePosition: FieldValue.delete(),
    estimatedQueueStartTime: FieldValue.delete(),
  });
  functions.logger.info("advanceQueue: moved to PREPARING", { orderId: nextDoc.id, stationId });
}

// Throttle: skip re-aggregation if we updated this item recently (reduce write amplification at peak)
const AGGREGATION_THROTTLE_MS = 3000;
function stockStatusFromAvailable(available, lowStockThreshold) {
  if (available <= 0) return "OUT_OF_STOCK";
  if (available <= lowStockThreshold) return "LOW_STOCK";
  return "AVAILABLE";
}

// --- Aggregate shards -> inventory_meta (consumed, available, stockStatus); throttled to reduce cost ---
exports.onInventoryShardWritten = functions.firestore
  .document("inventory_shards/{itemId}/shards/{shardId}")
  .onWrite(async (change, context) => {
    const itemId = context.params.itemId;
    const metaRef = db.collection("inventory_meta").doc(itemId);
    const metaSnap = await metaRef.get();
    const now = admin.firestore.Timestamp.now();
    if (metaSnap.exists) {
      const lastUpdated = metaSnap.data().lastUpdated;
      if (lastUpdated && lastUpdated.toMillis && (now.toMillis() - lastUpdated.toMillis() < AGGREGATION_THROTTLE_MS)) {
        return null; // Skip: updated recently
      }
    }
    const shardsRef = db.collection("inventory_shards").doc(itemId).collection("shards");
    const invRef = db.collection("inventory").doc(itemId);
    const shardsSnap = await shardsRef.get();
    let consumed = 0;
    shardsSnap.docs.forEach((d) => { consumed += d.data().count || 0; });
    const invSnap = await invRef.get();
    const totalStock = metaSnap.exists && metaSnap.data().totalStock != null
      ? metaSnap.data().totalStock
      : (invSnap.exists ? (invSnap.data().openingStock || 0) : 0);
    const lowStockThreshold = metaSnap.exists && metaSnap.data().lowStockThreshold != null
      ? metaSnap.data().lowStockThreshold
      : 20;
    const available = Math.max(0, totalStock - consumed);
    const stockStatus = stockStatusFromAvailable(available, lowStockThreshold);
    const itemName = (metaSnap.exists && metaSnap.data().itemName) || (invSnap.exists ? invSnap.data().itemName : "") || "";
    const category = (metaSnap.exists && metaSnap.data().category) || (invSnap.exists ? invSnap.data().category : "") || "";
    await metaRef.set({
      itemId,
      totalStock,
      consumed,
      available,
      stockStatus,
      lowStockThreshold,
      itemName,
      category,
      lastUpdated: FieldValue.serverTimestamp(),
    }, { merge: true });
    return null;
  });

// --- Pickup reminder: scheduled every 2 min, send reminder for READY orders whose window starts in ~2 min ---
exports.scheduledPickupReminder = functions.pubsub
  .schedule("every 2 minutes")
  .timeZone("Asia/Kolkata")
  .onRun(async (context) => {
    const now = Date.now();
    const windowStartMax = now + 3 * 60 * 1000;
    const ordersSnap = await db.collection("orders")
      .where("orderType", "==", "PREPARATION_ITEM")
      .where("serveFlowStatus", "==", "READY")
      .limit(50)
      .get();
    const fmt = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    let sent = 0;
    for (const docSnap of ordersSnap.docs) {
      const order = docSnap.data();
      if (order.sentPickupReminderAt) continue;
      const startMs = order.pickupWindowStart && order.pickupWindowStart.toMillis ? order.pickupWindowStart.toMillis() : 0;
      if (startMs < now || startMs > windowStartMax) continue;
      const pickupStartStr = fmt(startMs);
      const endMs = order.pickupWindowEnd && order.pickupWindowEnd.toMillis ? order.pickupWindowEnd.toMillis() : startMs + 2 * 60 * 1000;
      const pickupEndStr = fmt(endMs);
      const itemNames = (order.items || []).map((i) => i.name).filter(Boolean).join(", ");
      const tokens = await getFCMTokensForUser(order.userId);
      const notification = { title: "Pickup soon", body: `Pickup window ${pickupStartStr} – ${pickupEndStr}. ${itemNames || "Your order"} is ready.` };
      const data = { type: "PICKUP_REMINDER", orderId: docSnap.id, pickupWindowStart: pickupStartStr, pickupWindowEnd: pickupEndStr, itemNames: itemNames || "" };
      const { successCount } = await sendFCMToTokens(tokens, notification, data, { orderId: docSnap.id, userId: order.userId, type: "PICKUP_REMINDER" });
      if (successCount > 0) {
        await docSnap.ref.update({ sentPickupReminderAt: FieldValue.serverTimestamp() });
        sent++;
      }
    }
    if (sent > 0) functions.logger.info("Pickup reminders sent", { count: sent });
    return null;
  });

// --- fraudDetection (on order create trigger - optional) ---
exports.onOrderCreated = functions.firestore
  .document("orders/{orderId}")
  .onCreate(async (snap, context) => {
    const order = snap.data();
    const uid = order.userId;
    if (!uid || uid.startsWith("guest_")) return null;
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent = await db.collection("orders")
      .where("userId", "==", uid)
      .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(oneHourAgo))
      .get();
    if (recent.size > 10) {
      await db.collection("flags").doc(snap.id).set({
        orderId: snap.id,
        userId: uid,
        reason: "high_order_rate",
        count: recent.size,
        createdAt: FieldValue.serverTimestamp(),
      });
      functions.logger.warn("Fraud flag: high order rate", { orderId: snap.id, userId: uid, count: recent.size });
    }
    return null;
  });
