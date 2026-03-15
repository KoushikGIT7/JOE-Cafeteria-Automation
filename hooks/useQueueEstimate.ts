/**
 * useQueueEstimate - Optional queue prediction for student UI
 * Polls getQueueEstimate at an interval (default 30s) to show estimated wait.
 */

import { useState, useEffect, useCallback } from 'react';
import { getQueueEstimate } from '../services/firestore-db';

const DEFAULT_INTERVAL_MS = 30000;

export function useQueueEstimate(intervalMs: number = DEFAULT_INTERVAL_MS): {
  minutes: number;
  pendingCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<{ minutes: number; pendingCount: number }>({ minutes: 0, pendingCount: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await getQueueEstimate();
      setData({ minutes: result.minutes, pendingCount: result.pendingCount });
    } catch {
      setData({ minutes: 0, pendingCount: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, refresh]);

  return { ...data, loading, refresh };
}
