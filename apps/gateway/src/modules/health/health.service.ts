export interface HealthStatusResponse {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  version: string;
  environment: string;
  uptime: number;
  timestamp: string;
}

export interface LivenessResponse {
  status: 'ok';
  timestamp: string;
}

export interface ReadinessCheckDetail {
  status: 'ok' | 'error';
  message?: string;
}

export interface ReadinessResponse {
  status: 'ok' | 'error';
  ready: boolean;
  /** Explains why the instance is not ready, for example during shutdown. */
  reason?: string;
  checks: {
    database: ReadinessCheckDetail;
    redis: ReadinessCheckDetail;
    billing?: ReadinessCheckDetail;
  };
  timestamp: string;
}

export interface ReadinessChecks {
  database(): Promise<void>;
  redis(): Promise<void>;
  /**
   * The credit reservations have to be recovered before the instance serves
   * paid traffic. The check is optional, it is only configured when the
   * gateway owns a billing account.
   */
  billing?(): Promise<void> | undefined;
}

const DEFAULT_READINESS_CHECKS: ReadinessChecks = {
  async database(): Promise<void> {},
  async redis(): Promise<void> {},
};

export class HealthService {
  private readonly serviceName: string;
  private readonly version: string;
  private readonly environment: string;
  private shuttingDown = false;

  constructor(
    serviceName = 'gateway',
    version = '0.1.0',
    environment = process.env['NODE_ENV'] || 'development',
    private readonly readinessChecks: ReadinessChecks = DEFAULT_READINESS_CHECKS,
    private readonly readinessTimeoutMs = 5_000,
  ) {
    this.serviceName = serviceName;
    this.version = version;
    this.environment = environment;
  }

  /**
   * Marks the instance as shutting down. Readiness then fails while the
   * process keeps serving in-flight requests, so the load balancer removes
   * the pod from the Service before the listener is closed.
   */
  markShuttingDown(): void {
    this.shuttingDown = true;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  getHealth(): HealthStatusResponse {
    return {
      status: 'ok',
      service: this.serviceName,
      version: this.version,
      environment: this.environment,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    if (this.shuttingDown) {
      const detail: ReadinessCheckDetail = {
        status: 'error',
        message: 'Gateway is shutting down',
      };
      return {
        status: 'error',
        ready: false,
        reason: 'Gateway is shutting down',
        checks: {
          database: detail,
          redis: detail,
        },
        timestamp: new Date().toISOString(),
      };
    }

    const [dbCheck, redisCheck, billingCheck] = await Promise.all([
      this.runReadinessCheck('Database', () => this.readinessChecks.database()),
      this.runReadinessCheck('Redis', () => this.readinessChecks.redis()),
      this.readinessChecks.billing
        ? this.runReadinessCheck('Billing', async () => {
            await this.readinessChecks.billing!();
          })
        : Promise.resolve<ReadinessCheckDetail | undefined>(undefined),
    ]);

    const isReady =
      dbCheck.status === 'ok' &&
      redisCheck.status === 'ok' &&
      (billingCheck === undefined || billingCheck.status === 'ok');

    return {
      status: isReady ? 'ok' : 'error',
      ready: isReady,
      checks: {
        database: dbCheck,
        redis: redisCheck,
        ...(billingCheck ? { billing: billingCheck } : {}),
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async runReadinessCheck(
    dependency: string,
    check: () => Promise<void>,
  ): Promise<ReadinessCheckDetail> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${dependency} readiness check timed out`)),
            this.readinessTimeoutMs,
          );
          timeout.unref();
        }),
      ]);
      return { status: 'ok' };
    } catch {
      return {
        status: 'error',
        message: `${dependency} dependency is unavailable`,
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
