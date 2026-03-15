
import React, { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, Sparkles, Camera, ShieldCheck } from 'lucide-react';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
  isScanning?: boolean;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose, isScanning }) => {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const regionId = "qr-reader-region";

  useEffect(() => {
    // Initialize scanner
    const scanner = new Html5QrcodeScanner(
      regionId,
      { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
        showTorchButtonIfSupported: true,
        formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ]
      },
      /* verbose= */ false
    );

    scannerRef.current = scanner;

    const onScanSuccess = (decodedText: string) => {
      console.log(`[QR-SCANNER] Success: ${decodedText}`);
      onScan(decodedText);
      // Optional: stop scanner after success or keep scanning
      // scanner.clear(); 
    };

    const onScanFailure = (error: string) => {
      // Standard failure is just "QR code not found in frame" - very noisy
      // logger.debug(`[QR-SCANNER] Progress: ${error}`);
    };

    scanner.render(onScanSuccess, onScanFailure);

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between p-6 bg-gradient-to-b from-black/50 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
            <Camera className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
              JOE <span className="text-primary">Lens</span>
            </h2>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Secure Validator 2.0</p>
            </div>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all active:scale-95"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main Scanner Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
        <div className="w-full max-w-sm aspect-square relative">
            {/* Glossy Frame Overlay */}
            <div className="absolute inset-0 z-10 pointer-events-none">
                <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-primary rounded-tl-3xl shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
                <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-primary rounded-tr-3xl shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
                <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-primary rounded-bl-3xl shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
                <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-primary rounded-br-3xl shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
                
                {/* Scanning line animation */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan-line opacity-50" />
            </div>

            {/* The actual video feed */}
            <div id={regionId} className="w-full h-full rounded-2xl overflow-hidden bg-gray-900 shadow-2xl border border-white/10" />
            
            {isScanning && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20 rounded-2xl">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                        <p className="text-white font-black uppercase text-xs tracking-widest">Validating...</p>
                    </div>
                </div>
            )}
        </div>

        {/* Status & Instructions */}
        <div className="mt-12 w-full max-w-sm space-y-4">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/5 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-green-400 mt-0.5" />
                <p className="text-sm text-gray-300 leading-relaxed">
                    Point your camera at the <strong className="text-white">JOE Meal Token</strong>. 
                    Tokens are verified against real-time payment records.
                </p>
            </div>
            
            <div className="flex items-center justify-center gap-2 text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                <Sparkles className="w-3 h-3" />
                Hardware acceleration enabled
            </div>
        </div>
      </div>

      {/* Styles for the scan line animation */}
      <style>{`
        @keyframes scan-line {
            0% { top: 0% }
            100% { top: 100% }
        }
        .animate-scan-line {
            position: absolute;
            animation: scan-line 2s linear infinite;
        }
        #qr-reader-region__scan_region video {
            object-fit: cover !important;
            width: 100% !important;
            height: 100% !important;
        }
        #qr-reader-region {
            border: none !important;
        }
        #qr-reader-region img {
            display: none;
        }
        #qr-reader-region button {
            background: rgba(255,255,255,0.1) !important;
            color: white !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            border-radius: 12px !important;
            padding: 8px 16px !important;
            font-size: 14px !important;
            font-weight: 700 !important;
            text-transform: uppercase !important;
            margin-top: 20px !important;
        }
      `}</style>
    </div>
  );
};

export default QRScanner;
