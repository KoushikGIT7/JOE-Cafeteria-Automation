
import React, { useState } from 'react';
import { LogOut, Scan, CheckCircle, AlertCircle, RefreshCw, Smartphone, Package, User, Clock, Trash2 } from 'lucide-react';
import { UserProfile, Order } from '../../types';
import { validateQRForServing, scanAndServeOrder } from '../../services/firestore-db';
import Logo from '../../components/Logo';

interface ScannerViewProps {
  profile: UserProfile;
  onLogout: () => void;
}

const ScannerView: React.FC<ScannerViewProps> = ({ profile, onLogout }) => {
  const [scanning, setScanning] = useState(false);
  const [serving, setServing] = useState(false);
  const [scannedOrder, setScannedOrder] = useState<Order | null>(null);
  const [result, setResult] = useState<{ type: 'SUCCESS' | 'ERROR', message: string } | null>(null);
  const [lastScannedRaw, setLastScannedRaw] = useState<string>('');

  const handleScan = async () => {
    if (!profile?.uid) {
      alert("System Auth Error: Invalid staff node session.");
      return;
    }

    setScanning(true);
    setResult(null);
    setScannedOrder(null);

    const rawData = prompt("JOE V2.0 Scanner Interface\nPaste QR Token Data:");
    
    if (!rawData) {
      setScanning(false);
      return;
    }

    setLastScannedRaw(rawData);

    try {
      // Step 1: Validate the Token first (The 'Green Light' check)
      const order = await validateQRForServing(rawData);
      setScannedOrder(order);
    } catch (err: any) {
      setResult({
        type: 'ERROR',
        message: err.message || 'VALIDATION FAILED'
      });
    } finally {
      setScanning(false);
    }
  };

  const handleServeOrder = async () => {
    if (!scannedOrder || !lastScannedRaw) return;
    
    setServing(true);
    try {
      // Step 2: Actually serve and destroy (mark USED) the token
      await scanAndServeOrder(lastScannedRaw, profile.uid);
      setResult({
        type: 'SUCCESS',
        message: 'ORDER SERVED SUCCESSFULLY'
      });
      setScannedOrder(null);
    } catch (err: any) {
      setResult({
        type: 'ERROR',
        message: err.message || 'SERVE FAILED'
      });
    } finally {
      setServing(false);
    }
  };

  return (
    <div className="min-h-screen bg-textMain text-white flex flex-col max-w-md mx-auto font-sans">
      {/* Rugged Header */}
      <div className="p-6 flex justify-between items-center border-b border-white/5 bg-white/5 backdrop-blur-xl">
        <Logo size="sm" className="!text-white" />
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Server Node 01</p>
            <p className="text-sm font-bold">{profile?.name || 'Staff'}</p>
          </div>
          <button onClick={onLogout} className="p-2 bg-white/10 rounded-xl hover:bg-error transition-all active:scale-90">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-12">
        {!scannedOrder && !result && (
          <div className="w-full flex flex-col items-center animate-in fade-in zoom-in-95 duration-500">
            <div className="w-72 h-72 border-2 border-white/10 rounded-[3rem] flex items-center justify-center relative bg-white/5">
              <Scan className="w-32 h-32 text-primary/60 animate-pulse" />
              <div className="absolute inset-6 border border-primary/40 rounded-[2rem] opacity-20" />
              <div className="absolute -top-4 -right-4 bg-primary text-white p-3 rounded-2xl shadow-xl shadow-primary/40 animate-bounce">
                <Smartphone className="w-6 h-6" />
              </div>
            </div>
            
            <div className="text-center mt-12 space-y-4">
              <h2 className="text-3xl font-black tracking-tighter uppercase">Ready to Scan</h2>
              <p className="text-white/40 text-sm font-bold uppercase tracking-widest px-12">Show the student's QR code to the camera lens</p>
            </div>

            <button
              onClick={handleScan}
              disabled={scanning}
              className="w-full mt-12 bg-primary py-6 rounded-[2rem] font-black text-lg uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all shadow-2xl shadow-primary/20 disabled:opacity-50"
            >
              {scanning ? <RefreshCw className="animate-spin w-6 h-6" /> : <Scan className="w-6 h-6" />}
              Activate Lens
            </button>
          </div>
        )}

        {scannedOrder && (
          <div className="w-full p-8 rounded-[3rem] bg-success/5 border border-success/20 text-center space-y-8 animate-in zoom-in-95 duration-300">
            <div className="flex justify-center">
              <div className="w-20 h-20 bg-success rounded-3xl flex items-center justify-center shadow-lg shadow-success/20">
                <CheckCircle className="w-10 h-10 text-white" />
              </div>
            </div>

            <div className="space-y-1">
              <h2 className="text-3xl font-black text-success uppercase tracking-tighter">Valid Token</h2>
              <p className="text-white/40 text-[10px] font-black uppercase tracking-widest">Mark as served to complete</p>
            </div>

            <div className="bg-white/5 rounded-[2rem] p-6 text-left border border-white/5 space-y-6">
                <div className="flex items-center gap-4 border-b border-white/5 pb-4">
                  <div className="p-3 bg-white/5 rounded-2xl"><User className="w-5 h-5 text-primary" /></div>
                  <div>
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">Customer</p>
                    <p className="font-bold text-lg">{scannedOrder.userName}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {scannedOrder.items.map((item) => (
                    <div key={item.id} className="flex justify-between items-center bg-white/5 p-4 rounded-2xl">
                      <span className="font-bold flex items-center gap-2">
                        <Package className="w-4 h-4 text-white/30" />
                        {item.name}
                      </span>
                      <span className="bg-primary/20 text-primary px-3 py-1 rounded-lg text-xs font-black">x{item.quantity}</span>
                    </div>
                  ))}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setScannedOrder(null)}
                className="bg-white/5 py-5 rounded-[2rem] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="w-5 h-5" />
                Reject
              </button>
              <button
                onClick={handleServeOrder}
                disabled={serving}
                className="bg-success py-5 rounded-[2rem] font-black uppercase tracking-widest active:scale-95 transition-all shadow-xl shadow-success/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {serving ? <RefreshCw className="animate-spin w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                Serve Now
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className={`w-full p-10 rounded-[3rem] text-center space-y-8 animate-in zoom-in-95 duration-300 ${
            result.type === 'SUCCESS' ? 'bg-success/5 border border-success/20' : 'bg-error/5 border border-error/20'
          }`}>
            <div className="flex justify-center">
              {result.type === 'SUCCESS' ? (
                <div className="w-24 h-24 bg-success rounded-[2rem] flex items-center justify-center shadow-xl shadow-success/30">
                  <CheckCircle className="w-12 h-12 text-white" />
                </div>
              ) : (
                <div className="w-24 h-24 bg-error rounded-[2rem] flex items-center justify-center shadow-xl shadow-error/30">
                  <AlertCircle className="w-12 h-12 text-white" />
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <h2 className={`text-4xl font-black tracking-tighter uppercase ${result.type === 'SUCCESS' ? 'text-success' : 'text-error'}`}>
                {result.type === 'SUCCESS' ? 'COMPLETED' : 'TOKEN REJECTED'}
              </h2>
              <p className="text-white/60 font-black text-xs uppercase tracking-[0.2em]">{result.message}</p>
            </div>

            <button
              onClick={() => setResult(null)}
              className="w-full bg-white/10 hover:bg-white/20 py-5 rounded-[2rem] font-black uppercase tracking-widest transition-all active:scale-95"
            >
              Reset Terminal
            </button>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-8 border-t border-white/5 flex justify-between items-center bg-white/5">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-white/20" />
          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Session: 08:42:01</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Node Healthy</span>
        </div>
      </div>
    </div>
  );
};

export default ScannerView;
