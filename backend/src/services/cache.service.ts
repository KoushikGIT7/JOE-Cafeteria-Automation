import getRedisClient from '../config/redis';
import { logger } from '../utils/logger';

/**
 * Redis caching service wrapper with TTL support.
 * Provides get/set/del operations for the Order Service and other consumers.
 */
export class CacheService {
  /**
   * Get a cached value by key.
   * Returns null if not found or on Redis error (fail-open).
   */
  async get(key: string): Promise<string | null> {
    try {
      const client = await getRedisClient();
      return await client.get(key);
    } catch (error) {
      logger.warn('Cache GET failed (fail-open)', { key, error });
      return null;
    }
  }

  /**
   * Set a cached value with optional TTL in seconds.
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      const client = await getRedisClient();
      if (ttlSeconds) {
        await client.setEx(key, ttlSeconds, value);
      } else {
        await client.set(key, value);
      }
    } catch (error) {
      logger.warn('Cache SET failed (fail-open)', { key, error });
    }
  }

  /**
   * Delete a cached value by key.
   */
  async del(key: string): Promise<void> {
    try {
      const client = await getRedisClient();
      await client.del(key);
    } catch (error) {
      logger.warn('Cache DEL failed (fail-open)', { key, error });
    }
  }

  /**
   * Delete all keys matching a pattern (e.g. "orders:*").
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      const client = await getRedisClient();
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(keys);
      }
    } catch (error) {
      logger.warn('Cache DEL pattern failed (fail-open)', { pattern, error });
    }
  }
}

export const cacheService = new CacheService();
