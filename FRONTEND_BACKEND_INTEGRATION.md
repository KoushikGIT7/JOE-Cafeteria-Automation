# FRONTEND TO BACKEND INTEGRATION GUIDE

**Purpose**: Connect React frontend to Express TypeScript backend  
**Status**: Action items for frontend developer  
**Timeline**: Phase 2 of backend rollout

---

## 🔄 INTEGRATION OVERVIEW

### Current State (Firestore Direct)
```
React Component
     ↓
Firebase Client SDK
     ↓
Firestore (Client-side)
```

### Target State (Backend API)
```
React Component
     ↓
API Service (HTTP + WebSocket)
     ↓
Express Backend
     ↓
PostgreSQL + Redis
```

---

## 📁 FILES TO CREATE/MODIFY

### 1. Create API Configuration File

**File**: `src/services/api.ts` (NEW)

```typescript
import axios, { AxiosInstance, AxiosError } from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses (token expired)
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Try to refresh token
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/auth/refresh`,
            { refreshToken }
          );
          const { accessToken } = response.data.tokens;
          localStorage.setItem('access_token', accessToken);
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return apiClient(originalRequest);
        } catch (refreshError) {
          // Refresh failed - redirect to login
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/';
        }
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
```

### 2. Create API Endpoints File

**File**: `src/services/endpoints.ts` (NEW)

```typescript
export const API_ENDPOINTS = {
  // Auth
  AUTH: {
    GOOGLE_CALLBACK: '/auth/google-callback',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout'
  },

  // Orders
  ORDERS: {
    CREATE: '/orders',
    GET_BY_ID: (id: string) => `/orders/${id}`,
    GET_MY_ORDERS: '/orders',
    CANCEL: (id: string) => `/orders/${id}/cancel`,
    UPDATE_STATUS: (id: string) => `/orders/${id}/status`
  },

  // Payments
  PAYMENTS: {
    INITIATE: '/payments/initiate',
    VERIFY: '/payments/verify',
    REFUND: (id: string) => `/payments/${id}/refund`
  },

  // QR Codes
  QR: {
    VALIDATE: '/qr/validate',
    GET_STATUS: (token: string) => `/qr/${token}/status`
  },

  // Menu
  MENU: {
    GET_ALL: '/menu',
    GET_BY_ID: (id: string) => `/menu/${id}`,
    CREATE: '/menu',
    UPDATE: (id: string) => `/menu/${id}`,
    DELETE: (id: string) => `/menu/${id}`
  },

  // Admin
  ADMIN: {
    GET_ALL_ORDERS: '/admin/orders',
    GET_ALL_USERS: '/admin/users',
    UPDATE_USER_ROLE: (id: string) => `/admin/users/${id}/role`,
    GET_DAILY_REPORT: '/admin/reports/daily',
    UPDATE_SETTINGS: '/admin/settings/update'
  }
};
```

### 3. Update Authentication Service

**File**: `src/services/auth.ts` (MODIFY)

Replace Firestore calls with API calls:

```typescript
import { apiClient } from './api';
import { API_ENDPOINTS } from './endpoints';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../firebase';

export const signInWithGoogle = async (idToken: string) => {
  try {
    const response = await apiClient.post(API_ENDPOINTS.AUTH.GOOGLE_CALLBACK, {
      idToken
    });

    const { tokens, user } = response.data;

    // Store tokens
    localStorage.setItem('access_token', tokens.accessToken);
    localStorage.setItem('refresh_token', tokens.refreshToken);

    return user;
  } catch (error) {
    console.error('Google sign-in failed:', error);
    throw error;
  }
};

export const signOut = async () => {
  try {
    // Call backend logout endpoint
    await apiClient.post(API_ENDPOINTS.AUTH.LOGOUT);

    // Clear local storage
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');

    // Sign out from Firebase
    await firebaseSignOut(auth);
  } catch (error) {
    console.error('Sign out failed:', error);
  }
};

export const refreshAccessToken = async () => {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) throw new Error('No refresh token');

  const response = await apiClient.post(API_ENDPOINTS.AUTH.REFRESH, {
    refreshToken
  });

  const { accessToken } = response.data.tokens;
  localStorage.setItem('access_token', accessToken);

  return accessToken;
};
```

### 4. Update Order Service

**File**: `src/services/firestore-db.ts` (MODIFY - Add API functions)

```typescript
// Add these NEW functions alongside existing ones

import { apiClient } from './api';
import { API_ENDPOINTS } from './endpoints';
import { Order, MenuItem, CartItem } from '../types';

// CREATE ORDER
export const createOrder = async (
  items: CartItem[],
  paymentType: 'UPI' | 'CARD' | 'CASH' | 'NET'
): Promise<any> => {
  try {
    const response = await apiClient.post(API_ENDPOINTS.ORDERS.CREATE, {
      items: items.map(item => ({
        menuItemId: item.id,
        quantity: item.quantity
      })),
      paymentType
    });

    return response.data;
  } catch (error) {
    console.error('Create order failed:', error);
    throw error;
  }
};

// GET ORDER BY ID
export const getOrder = async (orderId: string): Promise<Order> => {
  try {
    const response = await apiClient.get(
      API_ENDPOINTS.ORDERS.GET_BY_ID(orderId)
    );
    return response.data;
  } catch (error) {
    console.error('Get order failed:', error);
    throw error;
  }
};

// GET USER'S ORDERS
export const getUserOrders = async (status?: string): Promise<Order[]> => {
  try {
    const response = await apiClient.get(API_ENDPOINTS.ORDERS.GET_MY_ORDERS, {
      params: { status }
    });
    return response.data.orders;
  } catch (error) {
    console.error('Get user orders failed:', error);
    throw error;
  }
};

// CANCEL ORDER
export const cancelOrder = async (orderId: string): Promise<any> => {
  try {
    const response = await apiClient.patch(
      API_ENDPOINTS.ORDERS.CANCEL(orderId)
    );
    return response.data;
  } catch (error) {
    console.error('Cancel order failed:', error);
    throw error;
  }
};

// GET MENU
export const getMenu = async (): Promise<MenuItem[]> => {
  try {
    const response = await apiClient.get(API_ENDPOINTS.MENU.GET_ALL);
    return response.data.items;
  } catch (error) {
    console.error('Get menu failed:', error);
    throw error;
  }
};

// INITIATE PAYMENT
export const initiatePayment = async (
  orderId: string,
  amount: number,
  paymentMethod: string
): Promise<any> => {
  try {
    const response = await apiClient.post(
      API_ENDPOINTS.PAYMENTS.INITIATE,
      {
        orderId,
        amount,
        paymentMethod
      }
    );
    return response.data;
  } catch (error) {
    console.error('Payment initiation failed:', error);
    throw error;
  }
};

// VERIFY PAYMENT
export const verifyPayment = async (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): Promise<any> => {
  try {
    const response = await apiClient.post(
      API_ENDPOINTS.PAYMENTS.VERIFY,
      {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature
      }
    );
    return response.data;
  } catch (error) {
    console.error('Payment verification failed:', error);
    throw error;
  }
};

// VALIDATE QR CODE
export const validateQR = async (qrToken: string, scannedData: string): Promise<any> => {
  try {
    const response = await apiClient.post(API_ENDPOINTS.QR.VALIDATE, {
      qrToken,
      scannedData
    });
    return response.data;
  } catch (error) {
    console.error('QR validation failed:', error);
    throw error;
  }
};

// Admin functions
export const getAllOrders = async (filters?: any): Promise<Order[]> => {
  try {
    const response = await apiClient.get(API_ENDPOINTS.ADMIN.GET_ALL_ORDERS, {
      params: filters
    });
    return response.data.orders;
  } catch (error) {
    console.error('Get all orders failed:', error);
    throw error;
  }
};

export const getDailyReport = async (date?: string): Promise<any> => {
  try {
    const response = await apiClient.get(
      API_ENDPOINTS.ADMIN.GET_DAILY_REPORT,
      {
        params: { date }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Get daily report failed:', error);
    throw error;
  }
};

export const updateSystemSettings = async (settings: any): Promise<any> => {
  try {
    const response = await apiClient.post(
      API_ENDPOINTS.ADMIN.UPDATE_SETTINGS,
      settings
    );
    return response.data;
  } catch (error) {
    console.error('Update settings failed:', error);
    throw error;
  }
};
```

### 5. Update useAuth Hook

**File**: `src/hooks/useAuth.ts` (MODIFY)

```typescript
import { useEffect, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { auth } from '../firebase';
import { getUserProfile } from '../services/firestore-db';
import { UserProfile, UserRole } from '../types';
import { onAuthStateChanged } from 'firebase/auth';

export function useAuth() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    // Check for existing tokens (backend already authenticated)
    const accessToken = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');

    if (!accessToken && !refreshToken) {
      // No tokens - user not logged in
      setLoading(false);
      return;
    }

    // Listen to Firebase auth state
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && accessToken) {
        setUser(firebaseUser);

        // Get user profile from backend OR Firestore
        try {
          // Try backend first
          const backendProfile = await getUserProfileFromBackend();
          setProfile(backendProfile);
          setRole(backendProfile.role);
        } catch (error) {
          // Fallback to Firestore
          console.warn('Backend call failed, falling back to Firestore:', error);
          const firestoreProfile = await getUserProfile(firebaseUser.uid);
          setProfile(firestoreProfile);
          setRole(firestoreProfile?.role || null);
        }
      } else {
        setUser(null);
        setProfile(null);
        setRole(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return { user, profile, loading, role };
}

// New function to get profile from backend
async function getUserProfileFromBackend(): Promise<UserProfile> {
  // This endpoint should be created in backend
  // Or reconstruct from JWT token claims
  const accessToken = localStorage.getItem('access_token');
  if (!accessToken) throw new Error('No token');

  // Decode JWT to get user info
  const decoded = JSON.parse(atob(accessToken.split('.')[1]));
  return {
    uid: decoded.userId,
    role: decoded.role
  } as any; // Type needs extension
}
```

### 6. Update HomeView Component

**File**: `src/views/Student/HomeView.tsx` (MODIFY)

Replace Firestore calls:

```typescript
// OLD (Firestore)
useEffect(() => {
  const unsubscribe = listenToMenu((items) => {
    setMenu(items);
    setLoading(false);
  });
  return unsubscribe;
}, []);

// NEW (Backend API)
useEffect(() => {
  const fetchMenu = async () => {
    try {
      const items = await getMenu();
      setMenu(items);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch menu:', error);
      setLoading(false);
    }
  };

  fetchMenu();
}, []);
```

### 7. Update PaymentView Component

**File**: `src/views/Student/PaymentView.tsx` (MODIFY)

```typescript
// When user completes payment:
const handlePaymentSuccess = async (razorpayResponse: any) => {
  try {
    // Verify payment with backend
    const result = await verifyPayment(
      razorpayResponse.razorpay_order_id,
      razorpayResponse.razorpay_payment_id,
      razorpayResponse.razorpay_signature
    );

    if (result.success) {
      showSuccess('Payment successful!');
      // Navigate to orders view
      onViewOrders?.();
    }
  } catch (error) {
    showError('Payment verification failed');
  }
};
```

### 8. Update CashierView / ScannerView

**File**: `src/views/Staff/ScannerView.tsx` (MODIFY)

```typescript
// When QR is scanned:
const handleQRScanned = async (data: string) => {
  try {
    const result = await validateQR(data, data);

    if (result.success) {
      // Order is now SERVED
      showSuccess(`Order ${result.order.id} served!`);
      // Update UI
      updateOrderUI(result.order);
    } else {
      showError(result.error);
    }
  } catch (error) {
    showError('QR validation failed');
  }
};
```

### 9. Update AdminDashboard

**File**: `src/views/Admin/Dashboard.tsx` (MODIFY)

```typescript
// Load orders
useEffect(() => {
  const fetchOrders = async () => {
    try {
      const allOrders = await getAllOrders({
        status: activeTab === 'Overview' ? 'ACTIVE' : undefined
      });
      setOrders(allOrders);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    }
  };

  fetchOrders();
}, [activeTab]);

// Load daily report
useEffect(() => {
  const fetchReport = async () => {
    try {
      const report = await getDailyReport();
      setReportData(report);
    } catch (error) {
      console.error('Failed to fetch report:', error);
    }
  };

  fetchReport();
}, []);
```

### 10. Install Required Dependencies

**package.json** - Add to dependencies:

```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "socket.io-client": "^4.5.0"
  }
}
```

```bash
npm install axios socket.io-client
```

### 11. Environment Configuration

**File**: `.env.local` (UPDATE)

```env
# Add API URL
VITE_API_URL=http://localhost:5000/api/v1

# Keep existing Firebase config
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
# ... other Firebase env vars
```

### 12. Update .env.example (for reference)

```env
# Frontend API
VITE_API_URL=http://localhost:5000/api/v1

# Firebase Configuration
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=joecafe-a7fff
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

---

## 🔌 WEBSOCKET INTEGRATION (Real-time Updates)

### Create Socket Service

**File**: `src/services/socket.ts` (NEW)

```typescript
import io, { Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function initializeSocket(token: string) {
  if (socket) return socket;

  socket = io(import.meta.env.VITE_API_URL?.replace('/api/v1', '') || 'http://localhost:5000', {
    auth: {
      token
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  socket.on('connect', () => {
    console.log('✅ Socket connected');
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected');
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// Subscribe functions
export function subscribeToOrder(orderId: string, callback: (data: any) => void) {
  getSocket()?.emit('order:subscribe', { orderId });
  getSocket()?.on('order:updated', callback);
  return () => {
    getSocket()?.off('order:updated', callback);
    getSocket()?.emit('order:unsubscribe', { orderId });
  };
}

export function subscribeToOrderStatus(
  orderId: string,
  callback: (status: string) => void
) {
  getSocket()?.on(`order:${orderId}:status`, callback);
  return () => {
    getSocket()?.off(`order:${orderId}:status`, callback);
  };
}

export function subscribeToPaymentConfirmation(
  orderId: string,
  callback: (data: any) => void
) {
  getSocket()?.on(`payment:${orderId}:confirmed`, callback);
  return () => {
    getSocket()?.off(`payment:${orderId}:confirmed`, callback);
  };
}

export function subscribeToDashboardUpdates(callback: (data: any) => void) {
  getSocket()?.emit('admin:connect');
  getSocket()?.on('dashboard:update', callback);
  return () => {
    getSocket()?.off('dashboard:update', callback);
  };
}
```

### Use Socket in Components

**Example**:

```typescript
import { useEffect, useState } from 'react';
import { subscribeToOrder } from '../services/socket';

export function OrderDetails({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState(null);

  useEffect(() => {
    // Subscribe to real-time updates
    const unsubscribe = subscribeToOrder(orderId, (updatedOrder) => {
      setOrder(updatedOrder);
    });

    return unsubscribe;
  }, [orderId]);

  return (
    <div>
      <h2>Order Status: {order?.orderStatus}</h2>
      {/* Display order details */}
    </div>
  );
}
```

---

## ✅ MIGRATION CHECKLIST

### Phase 1: Setup (Week 1)
- [ ] Create `api.ts` configuration file
- [ ] Create `endpoints.ts` file
- [ ] Install axios & socket.io-client
- [ ] Configure `.env.local` with API_URL

### Phase 2: Authentication (Week 1)
- [ ] Update `auth.ts` service
- [ ] Update `useAuth.ts` hook
- [ ] Test login flow
- [ ] Test token refresh

### Phase 3: Core Features (Week 2)
- [ ] Update `firestore-db.ts` with API calls
- [ ] Update HomeView menu loading
- [ ] Update PaymentView
- [ ] Update ScannerView (QR validation)

### Phase 4: Admin Features (Week 2)
- [ ] Update AdminDashboard orders loading
- [ ] Update reports loading
- [ ] Update settings management
- [ ] Test admin features

### Phase 5: Real-time (Week 3)
- [ ] Create Socket service
- [ ] Implement order status subscriptions
- [ ] Implement payment confirmations
- [ ] Implement admin dashboard updates

### Phase 6: Testing & Cleanup (Week 3)
- [ ] Test complete order flow
- [ ] Test payment processing
- [ ] Test QR scanning
- [ ] Remove Firestore direct calls (if confident)
- [ ] Test offline scenarios

---

## 🐛 TROUBLESHOOTING

### CORS Errors
**Problem**: `Access to XMLHttpRequest blocked by CORS policy`  
**Solution**: Ensure backend `FRONTEND_URL` env var matches your frontend URL

### 401 Unauthorized
**Problem**: API returns 401 on every request  
**Solution**: Check token is stored correctly:
```typescript
console.log(localStorage.getItem('access_token'));
```

### WebSocket Connection Fails
**Problem**: Socket won't connect  
**Solution**: Verify backend running on correct port:
```typescript
console.log('Connecting to:', import.meta.env.VITE_API_URL);
```

### VITE_API_URL undefined
**Problem**: Environment variable not accessible  
**Solution**: Variables must start with `VITE_` in Vite projects

---

## 📝 NEXT STEPS

1. **Backend Setup Complete**: Wait for backend team to deploy
2. **Test API Endpoints**: Use Postman/Insomnia to test endpoints
3. **Gradual Migration**: Migrate features one by one
4. **Parallel Running**: Keep Firestore as fallback during transition
5. **Full Cutover**: Once all features tested, disable Firestore calls
6. **Monitor Performance**: Track API response times

---

**Integration Complete When**:
- ✅ Login works with backend tokens
- ✅ Orders created via API
- ✅ Payments processed via Razorpay
- ✅ QR codes validated via API
- ✅ Admin features working
- ✅ Real-time updates showing
- ✅ All tests passing
- ✅ No Firestore direct calls in code

---

**Questions?** Refer to backend API documentation in `BACKEND_DEVELOPMENT_PROMPT.md`
