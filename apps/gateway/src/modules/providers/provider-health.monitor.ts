import { prisma, ProviderHealthStatus } from '@baseapikey/database';
import type { ProviderRegistry } from '@baseapikey/shared';

export interface ProviderHealthMonitorLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

export class ProviderHealthMonitor {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly intervalMs: number,
    private readonly logger: ProviderHealthMonitorLogger = console,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.checkAll();
    this.timer = setInterval(() => void this.checkAll(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async checkAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.allSettled(
        this.registry.list().map(async (provider) => {
          const slug = provider.getName();
          try {
            const result = await provider.healthCheck({
              timeoutMs: Math.min(10_000, this.intervalMs),
            });
            const status =
              result.status === 'healthy'
                ? ProviderHealthStatus.HEALTHY
                : result.status === 'degraded'
                  ? ProviderHealthStatus.DEGRADED
                  : ProviderHealthStatus.DOWN;
            await prisma.provider.updateMany({
              where: { slug },
              data: { healthStatus: status, healthCheckedAt: result.checkedAt },
            });
          } catch (error) {
            await prisma.provider.updateMany({
              where: { slug },
              data: { healthStatus: ProviderHealthStatus.DOWN, healthCheckedAt: new Date() },
            });
            this.logger.warn({ provider: slug, err: error }, 'Provider health check failed');
          }
        }),
      );
      this.logger.info(
        { providerCount: this.registry.list().length },
        'Provider health checks completed',
      );
    } finally {
      this.running = false;
    }
  }
}
