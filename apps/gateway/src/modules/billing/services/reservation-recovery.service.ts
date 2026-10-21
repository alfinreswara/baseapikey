import type { IReservationService } from './reservation.service';

export interface ReservationRecoveryLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface ReservationRecoveryResult {
  /** The number of the reservations that were recovered. */
  recovered: number;
  /** The recovery failed, the next run retries it. */
  failed: boolean;
  error?: unknown;
}

export const DEFAULT_RESERVATION_RECOVERY_INTERVAL_MS = 60_000;

const consoleLogger: ReservationRecoveryLogger = {
  info: (message, context) => console.log(message, context ?? ''),
  error: (message, context) => console.error(message, context ?? ''),
};

/**
 * Recovers the reservations of the requests that can no longer be running.
 *
 * A reservation is only recovered when its deadline has passed. The deadline
 * is derived from the maximum lifetime of a request, a reservation of a
 * running request is never released, not even when a new instance of the
 * gateway starts.
 *
 * The recovery is safe with several instances: the transition of a
 * reservation is a conditional update, only the instance that changes the
 * status returns the held credit. The credit of a reservation is therefore
 * never returned twice and no settlement is duplicated.
 */
export class ReservationRecoveryService {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly reservations: IReservationService,
    private readonly logger: ReservationRecoveryLogger = consoleLogger,
    /** Called after a successful run, the billing state is consistent again. */
    private readonly onRecovered: () => void = () => undefined,
  ) {}

  /**
   * Runs the recovery once. A failure is reported and does not throw, the
   * caller decides whether the instance may serve traffic.
   */
  async runOnce(): Promise<ReservationRecoveryResult> {
    if (this.running) {
      // A recovery of this instance is still in progress, the next interval
      // picks the remaining reservations up.
      return { recovered: 0, failed: false };
    }
    this.running = true;
    try {
      const recovered = await this.reservations.recoverExpiredReservations();
      if (recovered > 0) {
        this.logger.info('Recovered expired credit reservations', { recovered });
      }
      this.onRecovered();
      return { recovered, failed: false };
    } catch (error) {
      this.logger.error('The recovery of the expired credit reservations failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { recovered: 0, failed: true, error };
    } finally {
      this.running = false;
    }
  }

  /**
   * Starts the periodic recovery. The timer does not keep the process
   * alive, the shutdown of the gateway stops it.
   */
  start(intervalMs: number = DEFAULT_RESERVATION_RECOVERY_INTERVAL_MS): void {
    if (this.timer) return;
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
      throw new Error('The reservation recovery interval must be a positive integer');
    }
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }
}
