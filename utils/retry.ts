/**
 * Retry failed async operations (e.g. Firestore/callable) with backoff.
 * Use for network resilience and transient errors.
 */

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  retryable?: (error: unknown) => boolean;
}

const defaultRetryable = (error: unknown): boolean => {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: string }).code;
    return code === "unavailable" || code === "deadline-exceeded" || code === "resource-exhausted";
  }
  return false;
};

/**
 * Run an async function with retries. Retries on retryable errors (network, deadline).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    retryable = defaultRetryable,
  } = options;
  let lastError: unknown;
  let delay = delayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !retryable(error)) throw error;
      await new Promise((r) => setTimeout(r, delay));
      delay *= backoffMultiplier;
    }
  }
  throw lastError;
}
