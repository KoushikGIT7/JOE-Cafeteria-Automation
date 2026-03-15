import { useEffect, useState } from 'react';
import { MOTIVATIONAL_HEADLINES } from '../motivationalHeadlines';

const DISPLAY_DURATION_MS = 5500;

let sessionHeadline: string | null = null;

function pickHeadline(): string {
  if (sessionHeadline) return sessionHeadline;
  const i = Math.floor(Math.random() * MOTIVATIONAL_HEADLINES.length);
  sessionHeadline = MOTIVATIONAL_HEADLINES[i];
  return sessionHeadline;
}

/**
 * Shows one motivational headline for ~5.5s when enabled.
 * Uses one random headline per session so it doesn’t flip on every mount.
 */
export function useMotivationalHeadline(enabled: boolean) {
  const [visible, setVisible] = useState(false);
  const [headline, setHeadline] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }
    const h = pickHeadline();
    setHeadline(h);
    setVisible(true);
    const hideTimer = setTimeout(() => setVisible(false), DISPLAY_DURATION_MS);
    return () => clearTimeout(hideTimer);
  }, [enabled]);

  return { visible, headline };
}
