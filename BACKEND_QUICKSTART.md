# BACKEND QUICK START - Step-by-Step Implementation

**Time to First Deployment**: 4 weeks  
**Difficulty**: Intermediate to Advanced  
**Prerequisites**: Node.js 18+, PostgreSQL, Redis basics

---

## WEEK 1: FOUNDATION

### Day 1: Project Initialization
```bash
# Create backend directory
mkdir backend && cd backend

# Initialize Node project
npm init -y

# Install core dependencies
npm install express cors dotenv bcryptjs jsonwebtoken uuid pg redis socket.io helmet

# Install dev dependencies
npm install -D typescript @types/express @types/node @types/pg nodemon ts-node \
  prettier eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser

# Initialize TypeScript
npx tsc --init

# Create folder structure
mkdir -p src/{config,middleware,controllers,services,models,routes,utils,types,events,jobs,socket,seeders,migrations}
mkdir -p tests/{unit,integration}
mkdir -p logs
```

### Day 1-2: Environment Setup
```env
# .env.local
NODE_ENV=development
PORT=5000
LOG_LEVEL=debug

# Database
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/joe_cafeteria_dev
DATABASE_PASSWORD=yourpassword

# Redis
REDIS_URL=redis://localhost:6379/0

# JWT
JWT_SECRET=your-super-secure-jwt-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars
JWT_EXPIRE_IN=1h
JWT_REFRESH_EXPIRE_IN=7d

# Firebase (for token verification)
FIREBASE_PROJECT_ID=joecafe-a7fff

# Razorpay
RAZORPAY_KEY_ID=rzp_test_xxxx
RAZORPAY_KEY_SECRET=razorpay_test_secret

# Frontend
FRONTEND_URL=http://localhost:5173

# QR Encryption
QR_ENCRYPTION_KEY=your-32-char-encryption-key

# Email Service
SENDGRID_API_KEY=sg_xxxxxx

# Monitoring
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
```

### Day 2-3: Database Setup
```bash
# Install PostgreSQL (macOS)
brew install postgresql

# Install PostgreSQL (Windows)
# Download from https://www.postgresql.org/download/windows/

# Start PostgreSQL
brew services start postgresql  # macOS
# Or start from Windows Services

# Create database
createdb joe_cafeteria_dev
createdb joe_cafeteria_test

# Connect to database
psql -U postgres -d joe_cafeteria_dev

# Verify connection
\dt  # List tables
```

### Day 3: Create Initial Files

**src/app.ts** - Express Application
```typescript
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const app: Express = express();

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

export default app;
```

**server.ts** - Entry Point
```typescript
import app from './src/app';

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Server terminated');
    process.exit(0);
  });
});
```

**package.json** - Scripts
```json
{
  "scripts": {
    "dev": "NODE_ENV=development ts-node server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "migration:create": "ts-node src/migrations/create.ts",
    "migration:up": "ts-node src/migrations/up.ts",
    "migration:down": "ts-node src/migrations/down.ts",
    "seed": "ts-node src/seeders/seed.ts",
    "test": "jest",
    "lint": "eslint src/",
    "format": "prettier --write src/"
  }
}
```

### Day 4: Database Configuration

**src/config/database.ts**
```typescript
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export const query = (
  text: string,
  params?: (string | number | boolean | null | undefined)[]
) => pool.query(text, params);

export const getClient = () => pool.connect();

export default pool;
```

**src/config/redis.ts**
```typescript
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

export const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redis.on('error', (err) => console.log('Redis ClientError', err));
redis.on('connect', () => console.log('✅ Redis connected'));

redis.connect();

export default redis;
```

### Day 5: Database Migrations

**src/migrations/001_initial_schema.ts**
```typescript
import { query } from '../config/database';

export async function up() {
  try {
    // Users table
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        firebase_uid VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'student',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CHECK (role IN ('student', 'cashier', 'server', 'admin')),
        CHECK (status IN ('active', 'inactive', 'suspended'))
      );
      
      CREATE INDEX idx_users_email ON users(email);
      CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);
      CREATE INDEX idx_users_role ON users(role);
    `);

    // Menu items table
    await query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        cost_price DECIMAL(10, 2) NOT NULL,
        image_url VARCHAR(1000),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CHECK (category IN ('Breakfast', 'Lunch', 'Snacks', 'Beverages')),
        CHECK (status IN ('active', 'inactive', 'discontinued'))
      );
      
      CREATE INDEX idx_menu_category ON menu_items(category);
      CREATE INDEX idx_menu_status ON menu_items(status);
    `);

    // Orders table
    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        
        total_amount DECIMAL(12, 2) NOT NULL,
        tax_amount DECIMAL(10, 2) DEFAULT 0,
        final_amount DECIMAL(12, 2) NOT NULL,
        
        order_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        payment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        qr_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_GENERATION',
        
        payment_type VARCHAR(50) NOT NULL,
        payment_gateway_id VARCHAR(255),
        transaction_id VARCHAR(255) UNIQUE,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP,
        scanned_at TIMESTAMP,
        served_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CHECK (order_status IN ('PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'SERVED', 'CANCELLED', 'REJECTED')),
        CHECK (payment_status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
        CHECK (payment_type IN ('UPI', 'CARD', 'CASH', 'NET'))
      );
      
      CREATE INDEX idx_orders_user ON orders(user_id);
      CREATE INDEX idx_orders_status ON orders(order_status);
      CREATE INDEX idx_orders_payment_status ON orders(payment_status);
      CREATE INDEX idx_orders_created ON orders(created_at DESC);
      CREATE INDEX idx_orders_transaction ON orders(transaction_id);
    `);

    // Order items table
    await query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id UUID NOT NULL REFERENCES menu_items(id),
        quantity INT NOT NULL CHECK (quantity > 0),
        unit_price DECIMAL(10, 2) NOT NULL,
        total_price DECIMAL(12, 2) NOT NULL,
        served_qty INT DEFAULT 0,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX idx_order_items_order ON order_items(order_id);
    `);

    // QR codes table
    await query(`
      CREATE TABLE IF NOT EXISTS qr_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id),
        
        qr_token VARCHAR(500) UNIQUE NOT NULL,
        secure_hash VARCHAR(500) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        
        CHECK (status IN ('ACTIVE', 'USED', 'EXPIRED', 'REJECTED'))
      );
      
      CREATE INDEX idx_qr_token ON qr_codes(qr_token);
      CREATE INDEX idx_qr_order ON qr_codes(order_id);
      CREATE INDEX idx_qr_status ON qr_codes(status);
      CREATE INDEX idx_qr_expires ON qr_codes(expires_at) WHERE status = 'ACTIVE';
    `);

    // Payments table
    await query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id),
        
        amount DECIMAL(12, 2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        gateway_transaction_id VARCHAR(255),
        
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        attempt_count INT DEFAULT 1,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        
        CHECK (payment_method IN ('UPI', 'CARD', 'CASH', 'NET')),
        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'))
      );
      
      CREATE INDEX idx_payments_order ON payments(order_id);
      CREATE INDEX idx_payments_status ON payments(status);
    `);

    console.log('✅ Initial schema created');
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

export async function down() {
  try {
    await query('DROP TABLE IF EXISTS payments CASCADE');
    await query('DROP TABLE IF EXISTS qr_codes CASCADE');
    await query('DROP TABLE IF EXISTS order_items CASCADE');
    await query('DROP TABLE IF EXISTS orders CASCADE');
    await query('DROP TABLE IF EXISTS menu_items CASCADE');
    await query('DROP TABLE IF EXISTS users CASCADE');
    
    console.log('✅ Schema rolled back');
  } catch (error) {
    console.error('❌ Rollback error:', error);
    throw error;
  }
}

// Run migration
if (require.main === module) {
  up().catch(console.error);
}
```

### Day 5: Run Migration
```bash
npm run build
ts-node src/migrations/001_initial_schema.ts
```

---

## WEEK 2: AUTHENTICATION & CORE SERVICES

### Day 6-7: Authentication Service

**src/services/auth.service.ts**
```typescript
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool, { query } from '../config/database';
import { UserProfile } from '../types';

export class AuthService {
  generateTokens(userId: string, role: string) {
    const accessToken = jwt.sign(
      {
        userId,
        role,
        type: 'access',
        iat: Math.floor(Date.now() / 1000)
      },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRE_IN || '1h' }
    );

    const refreshToken = jwt.sign(
      {
        userId,
        type: 'refresh',
        iat: Math.floor(Date.now() / 1000)
      },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: process.env.JWT_REFRESH_EXPIRE_IN || '7d' }
    );

    return { accessToken, refreshToken };
  }

  async createUserFromFirebase(
    firebaseUid: string,
    email: string,
    name: string
  ): Promise<UserProfile> {
    const userId = uuidv4();

    try {
      const result = await query(
        `INSERT INTO users (id, firebase_uid, email, name, role, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
         RETURNING id, firebase_uid, email, name, role, status, created_at`,
        [userId, firebaseUid, email, name, 'student', 'active']
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  verifyToken(token: string) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET!) as any;
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  verifyRefreshToken(token: string) {
    try {
      return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as any;
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }
}

export const authService = new AuthService();
```

### Day 7-8: Middleware

**src/middleware/auth.ts**
```typescript
import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';

export interface AuthRequest extends Request {
  userId?: string;
  role?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'NO_TOKEN', message: 'No token provided' }
      });
    }

    const decoded = authService.verifyToken(token);
    req.userId = decoded.userId;
    req.role = decoded.role;

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
    });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
      });
    }
    next();
  };
}
```

### Day 8: Controllers

**src/controllers/auth.controller.ts**
```typescript
import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { query } from '../config/database';
import admin from 'firebase-admin';

export class AuthController {
  async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        return res.status(400).json({
          success: false,
          error: { message: 'ID token required' }
        });
      }

      // Verify Firebase token
      const decodedToken = await admin.auth().verifyIdToken(idToken);

      // Find or create user
      const result = await query(
        'SELECT * FROM users WHERE firebase_uid = $1',
        [decodedToken.uid]
      );

      let user;
      if (result.rows.length === 0) {
        user = await authService.createUserFromFirebase(
          decodedToken.uid,
          decodedToken.email || '',
          decodedToken.name || 'User'
        );
      } else {
        user = result.rows[0];
      }

      // Generate tokens
      const { accessToken, refreshToken } = authService.generateTokens(user.id, user.role);

      res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: 3600
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: { message: 'Refresh token required' }
        });
      }

      const decoded = authService.verifyRefreshToken(refreshToken);

      // Generate new tokens
      const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
        authService.generateTokens(decoded.userId, decoded.role);

      res.json({
        success: true,
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: 3600
        }
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: { message: 'Invalid refresh token' }
      });
    }
  }
}
```

### Day 8: Routes

**src/routes/auth.routes.ts**
```typescript
import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';

const router = Router();
const authController = new AuthController();

router.post('/google-callback', (req, res, next) =>
  authController.googleCallback(req, res, next)
);

router.post('/refresh', (req, res, next) =>
  authController.refreshToken(req, res, next)
);

export default router;
```

---

## WEEK 3: ORDER & PAYMENT SERVICES

### Day 9-12: Order Service

**src/services/order.service.ts** (See main prompt for full code)

### Day 12-14: Payment Integration

- Integrate Razorpay SDK
- Implement payment initiation
- Implement payment verification
- Handle payment webhooks

---

## WEEK 4: REAL-TIME & DEPLOYMENT

### Day 15-18: WebSocket Setup
- Initialize Socket.io
- Implement order status updates
- Implement admin notifications
- Implement payment confirmations

### Day 19-20: Deployment
- Build Docker image
- Deploy to cloud (Heroku, AWS, DigitalOcean)
- Setup monitoring (Sentry)
- Configure CI/CD pipeline

### Day 21: Testing & QA
- Write unit tests
- Write integration tests
- Load testing
- Security testing

---

## ✅ COMPLETION CHECKLIST

Week 1:
- [ ] Backend repository initialized
- [ ] Environment configured
- [ ] PostgreSQL & Redis setup
- [ ] Database migrations complete
- [ ] Basic Express app running

Week 2:
- [ ] Authentication service complete
- [ ] JWT tokens working
- [ ] Basic CRUD working
- [ ] Auth routes tested

Week 3:
- [ ] Order creation working
- [ ] Payment processing setup
- [ ] QR code generation
- [ ] API endpoints complete

Week 4:
- [ ] WebSocket real-time working
- [ ] Error handling implemented
- [ ] Logging setup
- [ ] Deployed to production
- [ ] Tests written

---

## 🚀 LOCAL TESTING COMMANDS

```bash
# Start development server
npm run dev

# Run database migrations
ts-node src/migrations/001_initial_schema.ts

# Seed initial data
npm run seed

# Run tests
npm test

# Build for production
npm run build

# Start production server
npm start
```

## 📝 WHAT'S NEXT

After basic implementation:
1. Add comprehensive error handling
2. Implement caching layer
3. Setup real-time notifications
4. Add email service
5. Create admin dashboard features
6. Setup analytics
7. Performance optimization
8. Load testing & scaling

---

**Ready to implement? Start with Day 1!**
