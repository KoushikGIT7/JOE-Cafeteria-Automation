import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import routes from './routes';
import { API_PREFIX } from './config/constants';

// Load environment variables
dotenv.config({ path: '.env.local' });

const app: Express = express();

// ============================================================
// Security Middleware
// ============================================================
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ============================================================
// Body Parsing
// ============================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ============================================================
// Request Logging
// ============================================================
app.use(requestLogger);

// ============================================================
// Health Check (root level)
// ============================================================
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ============================================================
// API Routes
// ============================================================
app.use(API_PREFIX, routes);

// ============================================================
// 404 Handler
// ============================================================
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'The requested route does not exist',
      statusCode: 404,
    },
  });
});

// ============================================================
// Centralized Error Handler (must be LAST)
// ============================================================
app.use(errorHandler);

export default app;
