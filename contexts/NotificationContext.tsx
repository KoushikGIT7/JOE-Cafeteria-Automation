import React, { useCallback, useEffect, useState } from 'react';
import { onForegroundMessage, type OrderReadyPayload } from '../services/fcm';
import type { NotificationToastData } from '../components/NotificationToast';
import NotificationToast from '../components/NotificationToast';

interface NotificationProviderProps {
  children: React.ReactNode;
  /** Called when user taps "View order" on the toast; use to navigate to QR/order screen */
  onViewOrder?: (orderId: string) => void;
}

export function NotificationProvider({ children, onViewOrder }: NotificationProviderProps) {
  const [toast, setToast] = useState<NotificationToastData | null>(null);

  const showToast = useCallback((data: NotificationToastData) => {
    setToast(data);
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  const handleViewOrder = useCallback(
    (orderId: string) => {
      onViewOrder?.(orderId);
      setToast(null);
    },
    [onViewOrder]
  );

  useEffect(() => {
    const unsub = onForegroundMessage((payload) => {
      if (payload.orderReady) {
        showToast({
          title: payload.title || 'Order Ready',
          body: payload.body,
          orderReady: payload.orderReady as OrderReadyPayload,
        });
      } else if (payload.title || payload.body) {
        showToast({
          title: payload.title,
          body: payload.body,
        });
      }
    });
    return () => {
      if (unsub) unsub();
    };
  }, [showToast]);

  return (
    <>
      {children}
      {toast && (
        <NotificationToast
          data={toast}
          onDismiss={dismissToast}
          onViewOrder={onViewOrder ? handleViewOrder : dismissToast}
        />
      )}
    </>
  );
}
