import { describe, it, expect } from "vitest";
import { TokenBucketRateLimiter, RateLimitError } from "../../src/security/rateLimit.js";

describe("TokenBucketRateLimiter", () => {
  it("is a no-op when rpm=0", () => {
    const rl = new TokenBucketRateLimiter(0);
    expect(rl.enabled()).toBe(false);
    for (let i = 0; i < 10_000; i++) rl.charge("alice");
    // no throw
  });

  it("starts each principal with a full bucket", () => {
    const rl = new TokenBucketRateLimiter(60);
    for (let i = 0; i < 60; i++) rl.charge("alice");
    expect(() => rl.charge("alice")).toThrow(RateLimitError);
  });

  it("isolates buckets per principal", () => {
    const rl = new TokenBucketRateLimiter(2);
    rl.charge("alice");
    rl.charge("alice");
    expect(() => rl.charge("alice")).toThrow(RateLimitError);
    rl.charge("bob"); // bob's bucket is independent
    rl.charge("bob");
  });

  it("refills over time", () => {
    let now = 0;
    const rl = new TokenBucketRateLimiter(60, () => now);
    for (let i = 0; i < 60; i++) rl.charge("alice");
    expect(() => rl.charge("alice")).toThrow();
    // 60 rpm = 1 token / sec. Advance 2s -> 2 tokens.
    now = 2_000;
    rl.charge("alice");
    rl.charge("alice");
    expect(() => rl.charge("alice")).toThrow();
  });

  it("includes retryAfterMs on the error", () => {
    let now = 0;
    const rl = new TokenBucketRateLimiter(60, () => now);
    for (let i = 0; i < 60; i++) rl.charge("alice");
    try {
      rl.charge("alice");
      throw new Error("expected RateLimitError");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect(e.retryAfterMs).toBeGreaterThan(0);
    }
  });
});
