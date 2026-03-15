import app from './src/app';
import { logger } from './src/utils/logger';
import { testConnection } from './src/config/database';
import { initSocket } from './src/socket/io';

const PORT = process.env.PORT || 5000;

async function startServer() {
  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.warn('Database connection failed — server starting without DB');
  }

  const server = app.listen(PORT, () => {
    logger.info(`✅ JOE Cafeteria Backend running on http://localhost:${PORT}`);
    logger.info(`📋 API Base URL: http://localhost:${PORT}/api/v1`);
    logger.info(`🔍 Health check: http://localhost:${PORT}/health`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Initialize Socket.io
  initSocket(server);

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully...`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after 10s timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle unhandled rejections
  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled rejection', { reason: reason?.message || reason });
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
