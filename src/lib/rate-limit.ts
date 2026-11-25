/**
 * In-memory sliding-window token bucket rate limiter.
 * Zero external dependencies (Redis/Memcached not required on single-host home server).
 * Automatically cleans expired keys periodically to keep RAM usage minimal.
 */

interface RateLimitRecord {
  timestamps: number[];
}

class MemoryRateLimiter {
  private store = new Map<string, RateLimitRecord>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Run cleanup every 2 minutes to prevent memory leaks
    if (typeof setInterval !== "undefined") {
      this.cleanupInterval = setInterval(() => this.cleanup(), 120_000);
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  /**
   * Check rate limit for a key within a window in seconds
   * @param key Unique key (e.g. `auth:ip:1.2.3.4` or `upload:userId`)
   * @param limit Max permitted actions
   * @param windowSeconds Time window in seconds
   */
  public check(
    key: string,
    limit: number,
    windowSeconds: number
  ): {
    success: boolean;
    limit: number;
    remaining: number;
    resetSeconds: number;
  } {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const threshold = now - windowMs;

    let record = this.store.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.store.set(key, record);
    }

    // Filter out timestamps older than threshold
    record.timestamps = record.timestamps.filter((ts) => ts > threshold);

    if (record.timestamps.length >= limit) {
      const oldest = record.timestamps[0];
      const resetSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return {
        success: false,
        limit,
        remaining: 0,
        resetSeconds,
      };
    }

    record.timestamps.push(now);
    return {
      success: true,
      limit,
      remaining: Math.max(0, limit - record.timestamps.length),
      resetSeconds: windowSeconds,
    };
  }

  /**
   * Reset limits for a specific key (e.g. on successful login)
   */
  public reset(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 600_000; // 10 minutes
    for (const [key, record] of this.store.entries()) {
      record.timestamps = record.timestamps.filter((ts) => ts > now - maxAge);
      if (record.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }
}

export const rateLimiter = new MemoryRateLimiter();
