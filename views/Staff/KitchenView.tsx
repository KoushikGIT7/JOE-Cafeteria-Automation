import React, { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, Clock, ChefHat, CheckCircle2, Loader2, UtensilsCrossed, ListOrdered } from 'lucide-react';
import { listenToPreparationOrders, updateServeFlowStatus } from '../../services/firestore-db';
import { SERVER_LABELS } from '../../constants';
import type { Order } from '../../types';
import type { ServeFlowStatus } from '../../types';

interface KitchenViewProps {
  onBack: () => void;
  /** Language for labels: 'en' | 'kn' */
  lang?: 'en' | 'kn';
}

const LABEL = (key: keyof typeof SERVER_LABELS, lang: 'en' | 'kn') => SERVER_LABELS[key][lang];

function CountdownLabel({ readyAtMs, lang }: { readyAtMs: number | undefined; lang: 'en' | 'kn' }) {
  const [secLeft, setSecLeft] = useState<number | null>(null);
  useEffect(() => {
    if (readyAtMs == null) {
      setSecLeft(null);
      return;
    }
    const tick = () => setSecLeft(Math.max(0, Math.round((readyAtMs - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [readyAtMs]);
  if (secLeft == null || secLeft <= 0) return null;
  return <span className="text-[10px] font-bold">{Math.ceil(secLeft / 60)} {LABEL('minLeft', lang)}</span>;
}

const KitchenView: React.FC<KitchenViewProps> = ({ onBack, lang: initialLang = 'en' }) => {
  const [lang, setLang] = useState<'en' | 'kn'>(initialLang);
  const [orders, setOrders] = useState<Order[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const unsub = listenToPreparationOrders((list) => setOrders(list), 80);
    return unsub;
  }, []);

  const byStatus = useMemo(() => {
    const map: Record<string, Order[]> = { NEW: [], QUEUED: [], PREPARING: [], READY: [] };
    orders.forEach((o) => {
      const status = (o.serveFlowStatus || 'NEW') as ServeFlowStatus;
      if (status in map) map[status].push(o);
    });
    map.NEW.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    map.QUEUED.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    map.PREPARING.sort((a, b) => (a.estimatedReadyTime || 0) - (b.estimatedReadyTime || 0));
    map.READY.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return map;
  }, [orders]);

  const setStatus = async (orderId: string, status: 'PREPARING' | 'READY') => {
    setUpdating(orderId);
    try {
      await updateServeFlowStatus(orderId, status);
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(null);
    }
  };

  const formatPickup = (order: Order) => {
    const start = order.pickupWindowStart;
    const end = order.pickupWindowEnd;
    if (start == null || end == null) return null;
    const s = new Date(start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const e = new Date(end).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${s} – ${e}`;
  };

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto pb-8">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-black/5 px-4 py-4 flex items-center gap-4">
        <button onClick={onBack} className="p-2 rounded-xl bg-gray-100" aria-label="Back">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold text-textMain flex items-center gap-2">
          <UtensilsCrossed className="w-5 h-5 text-primary" />
          {lang === 'kn' ? 'ಪ್ರಸ್ತುತಿ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್' : 'Preparation Dashboard'}
        </h1>
        <div className="flex rounded-xl overflow-hidden border border-black/10">
          <button
            type="button"
            onClick={() => setLang('en')}
            className={`px-3 py-2 text-xs font-bold ${lang === 'en' ? 'bg-primary text-white' : 'bg-gray-100 text-textSecondary'}`}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLang('kn')}
            className={`px-3 py-2 text-xs font-bold ${lang === 'kn' ? 'bg-primary text-white' : 'bg-gray-100 text-textSecondary'}`}
          >
            ಕನ್
          </button>
        </div>
      </header>

      <div className="p-4 space-y-6">
        {/* NEW */}
        <section>
          <h2 className="text-sm font-bold text-gray-600 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {LABEL('new', lang)} ({byStatus.NEW.length})
          </h2>
          <ul className="space-y-3">
            {byStatus.NEW.map((order) => {
              const isUpdating = updating === order.id;
              return (
                <li
                  key={order.id}
                  className="bg-white rounded-2xl p-4 border-2 border-gray-200 flex flex-col gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-black text-textMain">#{order.id.slice(-8)}</p>
                    <p className="text-xs text-textSecondary">{order.userName} · ₹{order.totalAmount}</p>
                    <p className="text-xs text-textMain mt-1 font-medium">
                      {order.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                    </p>
                  </div>
                  <button
                    disabled={isUpdating}
                    onClick={() => setStatus(order.id, 'PREPARING')}
                    className="w-full py-4 rounded-xl bg-amber-500 text-white text-base font-black uppercase tracking-wide flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
                  >
                    {isUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChefHat className="w-5 h-5" />}
                    {LABEL('startPreparing', lang)}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* QUEUED (slot full; auto-advances when PREPARING → READY) */}
        <section>
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-2">
            <ListOrdered className="w-4 h-4" />
            {LABEL('queued', lang)} ({byStatus.QUEUED.length})
          </h2>
          <ul className="space-y-3">
            {byStatus.QUEUED.map((order, idx) => {
              const isFirst = idx === 0;
              const isUpdating = updating === order.id;
              const pos = order.queuePosition ?? idx + 1;
              return (
                <li
                  key={order.id}
                  className={`rounded-2xl p-4 border-2 flex flex-col gap-3 ${isFirst ? 'bg-slate-100 border-slate-400' : 'bg-white border-slate-200'}`}
                >
                  <div className="min-w-0 flex items-start justify-between gap-2">
                    <div>
                      {isFirst && (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-black bg-primary text-white uppercase mb-1">
                          {LABEL('nextInQueue', lang)}
                        </span>
                      )}
                      <p className="font-mono text-sm font-black text-textMain">#{order.id.slice(-8)}</p>
                      <p className="text-xs text-textSecondary">{order.userName} · ₹{order.totalAmount}</p>
                      <p className="text-xs text-textMain mt-1 font-medium">
                        {order.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-1 font-bold flex items-center gap-1 flex-wrap">
                        {LABEL('queuePos', lang)} {pos}
                        {(order.estimatedQueueStartTime ?? order.estimatedReadyTime) != null && (
                          <> · <CountdownLabel readyAtMs={order.estimatedQueueStartTime ?? order.estimatedReadyTime} lang={lang} /></>
                        )}
                      </p>
                    </div>
                  </div>
                  {isFirst && (
                    <button
                      disabled={isUpdating}
                      onClick={() => setStatus(order.id, 'PREPARING')}
                      className="w-full py-3 rounded-xl bg-slate-600 text-white text-sm font-black uppercase flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChefHat className="w-4 h-4" />}
                      {LABEL('startPreparing', lang)}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* PREPARING (active slots) */}
        <section>
          <h2 className="text-sm font-bold text-amber-700 uppercase tracking-wider mb-2 flex items-center gap-2">
            <ChefHat className="w-4 h-4" />
            {LABEL('preparing', lang)} ({byStatus.PREPARING.length})
          </h2>
          <ul className="space-y-3">
            {byStatus.PREPARING.map((order) => {
              const isUpdating = updating === order.id;
              const pickup = formatPickup(order);
              return (
                <li
                  key={order.id}
                  className="bg-white rounded-2xl p-4 border-2 border-amber-300 flex flex-col gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-black text-textMain">#{order.id.slice(-8)}</p>
                    <p className="text-xs text-textSecondary">{order.userName} · ₹{order.totalAmount}</p>
                    <p className="text-xs text-textMain mt-1 font-medium">
                      {order.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                    </p>
                    {(order.estimatedReadyTime != null) && (
                      <p className="text-[10px] text-amber-700 mt-1 font-bold">
                        <CountdownLabel readyAtMs={order.estimatedReadyTime} lang={lang} />
                      </p>
                    )}
                    {pickup && (
                      <p className="text-[10px] text-amber-700 mt-0.5 font-bold">
                        {LABEL('pickupWindow', lang)}: {pickup}
                      </p>
                    )}
                  </div>
                  <button
                    disabled={isUpdating}
                    onClick={() => setStatus(order.id, 'READY')}
                    className="w-full py-4 rounded-xl bg-green-600 text-white text-base font-black uppercase tracking-wide flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
                  >
                    {isUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                    {LABEL('ready', lang)}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* READY (waiting for student to scan QR) */}
        <section>
          <h2 className="text-sm font-bold text-green-700 uppercase tracking-wider mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {LABEL('readyStatus', lang)} ({byStatus.READY.length})
          </h2>
          <ul className="space-y-3">
            {byStatus.READY.map((order) => {
              const pickup = formatPickup(order);
              return (
                <li
                  key={order.id}
                  className="bg-green-50 rounded-2xl p-4 border-2 border-green-400"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-black text-textMain">#{order.id.slice(-8)}</p>
                    <p className="text-xs text-textSecondary">{order.userName} · ₹{order.totalAmount}</p>
                    <p className="text-xs text-textMain mt-1 font-medium">
                      {order.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                    </p>
                    {pickup && (
                      <p className="text-[10px] text-green-700 mt-1 font-bold">
                        {LABEL('pickupWindow', lang)}: {pickup}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-green-700 font-bold mt-2">
                    {lang === 'kn' ? 'ವಿದ್ಯಾರ್ಥಿ QR ಸ್ಕ್ಯಾನ್ ಮಾಡಲು ಕಾಯಿರಿ' : 'Waiting for student to scan QR'}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default KitchenView;
