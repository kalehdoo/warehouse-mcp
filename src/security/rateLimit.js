/**
 * Per-principal token-bucket rate limiter.
 *
 * Bucket fills at rpm/60 tokens per second up to a capacity equal to rpm.
 * Each tool invocation costs one token. Empty bucket -> RateLimitError.
 *
 * Single-process in-memory state — fine for the v1 self-hosted single-tenant
 * shape. The SaaS variant will need a shared store (Redis) so multiple
 * server pods don't each grant independent buckets to the same key.
 *
 * Set MCP_RATE_LIMIT_RPM=0 to disable.
 */

export class RateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class TokenBucketRateLimiter {
  /**
   * @param {number} rpm  Requests per minute. 0 means disabled (no-op).
   * @param {() => number} [now]  Time source override for tests.
   */
  constructor(rpm, now = () => Date.now()) {
    this.rpm = rpm;
    this.now = now;
    this.buckets = new Map(); // principal -> {tokens, lastRefillTs}
  }

  enabled() {
    return this.rpm > 0;
  }

  /**
   * Charge one token to the principal's bucket. Throws RateLimitError if empty.
   * @param {string} principal
   */
  charge(principal) {
    if (!this.enabled()) return;
    const capacity = this.rpm;
    const refillPerMs = this.rpm / 60_000;
    const now = this.now();
    let bucket = this.buckets.get(principal);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefillTs: now };
      this.buckets.set(principal, bucket);
    }
    const elapsed = now - bucket.lastRefillTs;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.lastRefillTs = now;
    if (bucket.tokens < 1) {
      const needed = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil(needed / refillPerMs);
      throw new RateLimitError(
        `Rate limit exceeded for ${principal} (limit ${this.rpm} requests/min). Retry in ~${Math.ceil(retryAfterMs / 1000)}s.`,
        retryAfterMs,
      );
    }
    bucket.tokens -= 1;
  }

  /** Test-only: forget all buckets. */
  reset() {
    this.buckets.clear();
  }
}
