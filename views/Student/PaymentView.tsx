
import React, { useState, useEffect } from 'react';
import { ChevronLeft, CreditCard, Smartphone, Landmark, Banknote, ShieldCheck, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { UserProfile, CartItem } from '../../types';
import { createOrder, listenToOrder, getOrder, getOrderingEnabled } from '../../services/firestore-db';

interface PaymentViewProps {
  profile: UserProfile | null;
  onBack: () => void;
  onSuccess: (orderId: string) => void;
}

const PaymentView: React.FC<PaymentViewProps> = ({ profile, onBack, onSuccess }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [state, setState] = useState<'IDLE' | 'PROCESSING' | 'CASH_WAITING' | 'REJECTED'>('IDLE');
  const [selectedMethod, setSelectedMethod] = useState<string>('UPI');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<'PENDING' | 'APPROVED' | null>(null);
  const [rejectionMessage, setRejectionMessage] = useState<string>('');
  const [orderingDisabled, setOrderingDisabled] = useState<boolean>(false);

  // Load cart and restore pending order state
  useEffect(() => {
    const savedCart = localStorage.getItem('joe_cart');
    if (savedCart) {
      try {
        setCart(JSON.parse(savedCart));
      } catch (e) {
        console.error("Cart parse error", e);
      }
    }
  }, []);

  useEffect(() => {
    getOrderingEnabled().then((enabled) => setOrderingDisabled(!enabled)).catch(() => setOrderingDisabled(false));
  }, []);
  
  // Listener for cash payment confirmation - automatically navigate to QR when approved
  useEffect(() => {
    if (state === 'CASH_WAITING' && orderId) {
      console.log('🔔 Setting up listener for order:', orderId);
      let hasNavigated = false; // Prevent multiple navigations
      
      const unsubscribe = listenToOrder(orderId, (order) => {
        console.log('📦 Order update received:', {
          orderId: order?.id,
          paymentStatus: order?.paymentStatus,
          qrStatus: order?.qrStatus,
          hasOrder: !!order
        });
        
        // Update status indicator
        if (order) {
          if (order.paymentStatus === 'SUCCESS' && order.qrStatus === 'ACTIVE') {
            setOrderStatus('APPROVED');
          } else if (order.paymentStatus === 'PENDING') {
            setOrderStatus('PENDING');
          }
        }
        
        if (order && order.paymentStatus === 'SUCCESS' && order.qrStatus === 'ACTIVE' && !hasNavigated) {
          console.log('✅ Payment confirmed! Navigating to QR view...');
          hasNavigated = true;
          onSuccess(orderId);
          return;
        }

        if (order && order.paymentStatus === 'REJECTED' && !hasNavigated) {
          console.warn('❌ Payment rejected by cashier');
          hasNavigated = true;
          setOrderStatus(null);
          setRejectionMessage('Your payment was rejected by the cashier. Please try again or contact support.');
          setState('REJECTED');
          // Auto-redirect to home after 3 seconds
          const timer = setTimeout(() => {
            onBack();
          }, 3000);
          return () => clearTimeout(timer);
        }

        if (!order) {
          console.warn('⚠️ Order not found:', orderId);
        } else if (order.paymentStatus !== 'SUCCESS') {
          console.log('⏳ Still waiting for payment confirmation...');
        }
      });
      return unsubscribe;
    }
  }, [state, orderId, onSuccess]);

  const total = cart.reduce((acc, curr) => acc + (curr.price * curr.quantity), 0);

  const handlePayment = async () => {
    setState('PROCESSING');
    
    // Prevent browser from showing credential dialogs during payment
    try {
      // Disable credential storage during payment
      if (window.navigator && window.navigator.credentials) {
        window.navigator.credentials = undefined as any;
      }
    } catch (e) {
      // Silently fail if we can't disable credentials
    }
    
    // Simulate payment gateway delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      const isCash = selectedMethod === 'CASH';
      const guestId = profile?.uid || `guest_${Date.now()}`;
      const guestName = profile?.name || 'Guest';
      
      console.log('💳 Processing payment for:', { isCash, guestId, method: selectedMethod });
      
      const newOrderId = await createOrder({
        userId: guestId,
        userName: guestName,
        items: cart,
        totalAmount: total,
        paymentType: selectedMethod as any,
        paymentStatus: isCash ? 'PENDING' : 'SUCCESS',
        orderStatus: 'PENDING',
        qrStatus: isCash ? 'PENDING_PAYMENT' : 'ACTIVE',
        cafeteriaId: 'MAIN_CAFE'
      });

      console.log('✅ Order created successfully:', newOrderId);
      
      setOrderId(newOrderId);
      // Store guest order ID in sessionStorage for guest checkout flow
      if (!profile) {
        try {
          sessionStorage.setItem('joe_guest_order_id', newOrderId);
        } catch (e) {
          console.warn('Could not store guest order ID', e);
        }
      }
      // Clear cart (keep in localStorage for UX, but order is in Firestore)
      localStorage.removeItem('joe_cart');
      
      if (isCash) {
        console.log('⏳ Waiting for cash payment approval...');
        setState('CASH_WAITING');
      } else {
        console.log('🎯 Payment successful, navigating to QR...');
        onSuccess(newOrderId);
      }
    } catch (err: any) {
      console.error('❌ Payment processing error:', err);
      setState('IDLE');
      const msg = (err?.message || err?.code || '').toString();
      if (msg.includes('ORDERING_DISABLED')) {
        alert('Ordering is temporarily disabled. Please try again later.');
        return;
      }
      if (msg.includes('OUT_OF_STOCK') || msg.toLowerCase().includes('out of stock')) {
        alert('Item is currently out of stock. Please remove it from your cart and try again.');
        return;
      }
      if (msg.includes('BURST_LIMIT')) {
        alert('Order limit exceeded. Maximum 25 different items and 10 per item. Please reduce your cart.');
        return;
      }
      if (msg.includes('RATE_LIMIT') || msg.includes('5 seconds')) {
        alert('Please wait at least 5 seconds between orders.');
        return;
      }
      if (msg.includes('MAX_ACTIVE_ORDERS')) {
        alert('You can have at most 3 active orders. Complete or cancel one first.');
        return;
      }
      alert("Order creation failed. Please try again.");
    }
  };

  const methods = [
    { id: 'UPI', name: 'UPI', icon: Smartphone, color: 'text-primary' },
    { id: 'CARD', name: 'Card', icon: CreditCard, color: 'text-blue-500' },
    { id: 'NET', name: 'Net Banking', icon: Landmark, color: 'text-purple-500' },
    { id: 'CASH', name: 'Pay at Counter (Cash)', icon: Banknote, color: 'text-cash' },
  ];

  if (state === 'PROCESSING') {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-8 bg-white max-w-md mx-auto text-center">
        <Loader2 className="w-16 h-16 text-primary animate-spin mb-6" />
        <h2 className="text-2xl font-bold text-textMain">Verifying Securely</h2>
        <p className="text-textSecondary mt-2">Connecting to JOE backend...</p>
      </div>
    );
  }

  if (state === 'REJECTED') {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-8 bg-white max-w-md mx-auto text-center">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6 animate-pulse">
          <svg className="w-10 h-10 text-red-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-red-600">Payment Rejected</h2>
        <p className="text-textSecondary mt-4 px-4 leading-relaxed">
          {rejectionMessage}
        </p>
        <p className="text-xs text-textSecondary mt-6 animate-pulse">
          Redirecting to home in 3 seconds...
        </p>
        <div className="mt-8">
          <button
            onClick={onBack}
            className="px-6 py-3 bg-primary text-white font-bold rounded-xl"
          >
            Go Back Now
          </button>
        </div>
      </div>
    );
  }

  if (state === 'CASH_WAITING') {
    const handleManualCheck = async () => {
      if (!orderId) return;
      console.log('🔄 Manual check triggered for order:', orderId);
      
      // Check order from Firestore using service function
      try {
        const order = await getOrder(orderId);
        if (order) {
          console.log('📋 Manual check result:', {
            orderFound: true,
            paymentStatus: order.paymentStatus,
            qrStatus: order.qrStatus
          });
          
          if (order.paymentStatus === 'SUCCESS' && order.qrStatus === 'ACTIVE') {
            console.log('✅ Order approved! Navigating to QR...');
            setOrderStatus('APPROVED');
            sessionStorage.removeItem('joe_pending_order_id');
            onSuccess(orderId);
          } else {
            setOrderStatus(order.paymentStatus === 'PENDING' ? 'PENDING' : null);
            alert(`Order status: ${order.paymentStatus}, QR: ${order.qrStatus}. Still waiting for approval.`);
          }
        } else {
          alert('Order not found. Please contact support.');
        }
      } catch (error) {
        console.error('Error checking order:', error);
        alert('Error checking order status. Please try again.');
      }
    };
    
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-8 bg-white max-w-md mx-auto text-center">
        <div className="w-20 h-20 bg-cash/10 rounded-full flex items-center justify-center mb-6">
          {orderStatus === 'APPROVED' ? (
            <CheckCircle2 className="w-10 h-10 text-success animate-pulse" />
          ) : (
            <Clock className="w-10 h-10 text-cash animate-pulse" />
          )}
        </div>
        <h2 className="text-2xl font-bold text-textMain">
          {orderStatus === 'APPROVED' ? 'Payment Approved!' : 'Go to Cashier'}
        </h2>
        <p className="text-textSecondary mt-4 px-4 leading-relaxed">
          {orderStatus === 'APPROVED' ? (
            <>
              Your order <strong className="text-textMain">#{orderId?.slice(-6).toUpperCase()}</strong> has been approved!
              <br /><br />
              <span className="text-xs font-bold uppercase tracking-wider bg-success/10 text-success px-3 py-1 rounded-full">
                ✅ Redirecting to QR code...
              </span>
            </>
          ) : (
            <>
              Your order <strong className="text-textMain">#{orderId?.slice(-6).toUpperCase()}</strong> is pending. 
              Please pay <span className="text-primary font-bold">₹{total}</span> at the counter. 
              <br /><br />
              <span className="text-xs font-bold uppercase tracking-wider bg-primary/10 text-primary px-3 py-1 rounded-full">
                ⏳ Waiting for cashier approval... Your QR code will appear automatically once confirmed.
              </span>
            </>
          )}
        </p>
        <div className="mt-8 w-full max-w-xs">
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <p className="text-xs text-textSecondary font-bold mb-2">Order Details</p>
            <p className="text-sm font-mono font-black text-textMain">#{orderId?.slice(-8).toUpperCase()}</p>
            {orderStatus && (
              <p className={`text-xs font-bold mt-2 ${
                orderStatus === 'APPROVED' ? 'text-success' : 'text-cash'
              }`}>
                Status: {orderStatus}
              </p>
            )}
          </div>
        </div>
        {orderStatus !== 'APPROVED' && (
          <>
            <p className="text-xs text-textSecondary mt-4 mb-4">
              Please keep this page open. You will be redirected automatically when payment is confirmed.
            </p>
            <button
              onClick={handleManualCheck}
              className="text-xs text-primary font-bold underline hover:no-underline"
            >
              Check Status Manually
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-background max-w-md mx-auto overflow-hidden">
      {/* Header */}
      <div className="p-4 bg-white flex items-center gap-4 border-b">
        <button onClick={onBack} className="p-2 -ml-2 text-textMain"><ChevronLeft className="w-6 h-6" /></button>
        <h2 className="text-xl font-bold text-textMain">Checkout</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Order Summary */}
        <div className="bg-white rounded-2xl p-4 shadow-sm mb-6 border border-gray-100">
          <h3 className="text-xs font-bold text-textSecondary uppercase tracking-wider mb-3">Order Summary</h3>
          <div className="space-y-2">
            {cart.map(item => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-textMain font-medium">{item.name} x {item.quantity}</span>
                <span className="font-bold text-textMain">₹{item.price * item.quantity}</span>
              </div>
            ))}
            <div className="pt-2 mt-2 border-t border-dashed flex justify-between items-center">
              <span className="font-bold text-textSecondary text-sm">Amount to Pay</span>
              <span className="text-2xl font-bold text-primary">₹{total}</span>
            </div>
          </div>
        </div>

        {/* Methods */}
        <h3 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-4 px-1">Choose Payment Method</h3>
        <div className="space-y-3">
          {methods.map(method => (
            <button
              key={method.id}
              onClick={() => setSelectedMethod(method.id)}
              className={`w-full p-4 rounded-2xl flex items-center gap-4 transition-all border-2 ${
                selectedMethod === method.id 
                ? 'bg-white border-primary ring-4 ring-primary/5 shadow-sm' 
                : 'bg-white border-gray-100 shadow-sm'
              }`}
            >
              <div className={`p-2 rounded-xl bg-gray-50 ${method.color}`}>
                <method.icon className="w-6 h-6" />
              </div>
              <span className="flex-1 text-left font-bold text-textMain">{method.name}</span>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                selectedMethod === method.id ? 'border-primary bg-primary' : 'border-gray-200'
              }`}>
                {selectedMethod === method.id && <div className="w-2 h-2 bg-white rounded-full" />}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="p-6 bg-white border-t space-y-4">
        {orderingDisabled && (
          <p className="text-amber-600 text-sm font-bold text-center">Ordering is temporarily disabled.</p>
        )}
        <div className="flex items-center justify-center gap-2 text-[10px] text-textSecondary font-bold uppercase tracking-widest">
          <ShieldCheck className="w-4 h-4 text-primary" />
          Secured by JOE Payment Node
        </div>
        <button
          onClick={handlePayment}
          disabled={cart.length === 0 || state === 'PROCESSING' || orderingDisabled}
          className="w-full bg-primary text-white font-bold py-5 rounded-2xl shadow-xl shadow-primary/20 active:scale-95 transition-all disabled:opacity-50"
          autoComplete="off"
          data-lpignore="true"
          data-form-type="other"
        >
          {selectedMethod === 'CASH' ? 'Confirm Order' : `Pay ₹${total} Now`}
        </button>
      </div>
    </div>
  );
};

export default PaymentView;
