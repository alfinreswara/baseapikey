export interface LoginRateLimitContext {
  ipAddress?: string;
}

export interface ILoginRateLimiter {
  checkRateLimit(key: string, context?: LoginRateLimitContext): Promise<void>;
}

export class NoopLoginRateLimiter implements ILoginRateLimiter {
  async checkRateLimit(_key: string, _context?: LoginRateLimitContext): Promise<void> {
    // Interface-only implementation for future rate limiting middleware
  }
}
