/**
 * FCM (Firebase Cloud Messaging) token registration for push notifications.
 * Saves the device token to users/{uid}.fcmToken (primary) and users/{uid}/fcmTokens/{tokenId}
 * for multi-device support and efficient batch sends.
 */

import { getMessaging, getToken, isSupported, onMessage, type Messaging } from "firebase/messaging";
import { doc, setDoc, collection, serverTimestamp } from "firebase/firestore";
import app, { db } from "../firebase";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";

let messaging: Messaging | null = null;

function getMessagingInstance(): Messaging | null {
  if (typeof window === "undefined") return null;
  if (messaging) return messaging;
  try {
    messaging = getMessaging(app);
    return messaging;
  } catch (e) {
    console.warn("FCM getMessaging failed (e.g. in dev or unsupported):", e);
    return null;
  }
}

/** Stable id for deduplication: same token always maps to same id (max 20 chars for Firestore doc id). */
async function tokenId(token: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 20);
    return hex;
  }
  return token.slice(0, 20).replace(/[/.]/g, "_");
}

/**
 * Request notification permission, get FCM token, and save to Firestore:
 * - users/{uid}.fcmToken (primary, for backward compat and single read)
 * - users/{uid}/fcmTokens/{tokenId} (multi-device; backend can batch send to all)
 * Call when the user signs in. Fails silently if permission denied or unsupported.
 */
export async function registerFCMToken(uid: string): Promise<void> {
  if (!uid) return;
  const supported = await isSupported().catch(() => false);
  if (!supported) {
    console.debug("FCM not supported in this environment");
    return;
  }
  const messagingInstance = getMessagingInstance();
  if (!messagingInstance) return;
  if (!VAPID_KEY) {
    console.warn("FCM: VITE_FIREBASE_VAPID_KEY not set. Add Web Push certificate from Firebase Console > Project Settings > Cloud Messaging.");
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.debug("FCM: Notification permission not granted");
      return;
    }
    const token = await getToken(messagingInstance, { vapidKey: VAPID_KEY });
    if (!token) return;
    const id = await tokenId(token);
    const now = serverTimestamp();
    await setDoc(doc(db, "users", uid), { fcmToken: token, fcmTokenUpdatedAt: now }, { merge: true });
    await setDoc(doc(db, "users", uid, "fcmTokens", id), { token, updatedAt: now }, { merge: true });
    console.debug("FCM token registered for user", uid.slice(0, 8) + "…");
  } catch (e) {
    console.warn("FCM token registration failed:", e);
  }
}

/** Parsed payload for ORDER_READY (matches Cloud Function data payload). */
export interface OrderReadyPayload {
  type: "ORDER_READY";
  orderId: string;
  pickupWindowStart: string;
  pickupWindowEnd: string;
  itemNames?: string;
}

/**
 * Subscribe to foreground messages; show in-app toast with item name, pickup window, and "View order" action.
 * Call once after app load (e.g. in a provider). Callback receives structured data for ORDER_READY.
 */
export function onForegroundMessage(
  callback: (payload: { title?: string; body?: string; data?: Record<string, string>; orderReady?: OrderReadyPayload }) => void
): (() => void) | null {
  if (typeof window === "undefined") return null;
  const messagingInstance = getMessagingInstance();
  if (!messagingInstance) return null;
  return onMessage(messagingInstance, (payload) => {
    const data = (payload.data as Record<string, string>) || {};
    const orderReady: OrderReadyPayload | undefined =
      data.type === "ORDER_READY"
        ? {
            type: "ORDER_READY",
            orderId: data.orderId || "",
            pickupWindowStart: data.pickupWindowStart || "",
            pickupWindowEnd: data.pickupWindowEnd || "",
            itemNames: data.itemNames,
          }
        : undefined;
    callback({
      title: payload.notification?.title,
      body: payload.notification?.body,
      data,
      orderReady,
    });
  });
}
