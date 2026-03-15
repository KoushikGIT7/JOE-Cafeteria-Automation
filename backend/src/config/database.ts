import { Pool, PoolClient, QueryResult } from 'pg';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err: Error) => {
  logger.error('Unexpected error on idle database client', { error: err.message });
});

pool.on('connect', () => {
  logger.info('New database client connected');
});

/**
 * Execute a parameterized query against the connection pool.
 */
export const query = async (
  text: string,
  params?: any[]
): Promise<QueryResult> => {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  logger.debug('Executed query', {
    text: text.substring(0, 100),
    duration: `${duration}ms`,
    rows: result.rowCount,
  });

  return result;
};

/**
 * Get a dedicated client from the pool for transactions.
 * Caller MUST release the client when done.
 */
export const getClient = (): Promise<PoolClient> => pool.connect();

/**
 * Test database connectivity.
 */
export const testConnection = async (): Promise<boolean> => {
  try {
    await pool.query('SELECT NOW()');
    logger.info('✅ Database connection verified');
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed', { error });
    return false;
  }
};

export default pool;
