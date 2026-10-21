import type { IReservationService } from './reservation.service';

export interface ReservationLeaseLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface ReservationLeaseOptions {
  /** The duration of the lease, the reservation is recovered when it ends. */
  lifetimeMs: number;
  /** The interval between two renewals, it has to be shorter than the lease. */
  intervalMs: number;
  /**
   * Called when the credit guarantee of the request can no longer be kept.
   * The request has to be stopped, a request that is served without a
   * guaranteed credit can not be billed reliably.
   */
  onGuaranteeLost: (reason: string) => void;
  logger?: ReservationLeaseLogger | undefined;
}

/**
 * The lease of a credit reservation.
 *
 * The reservation of a request is only recovered when its deadline has
 * passed. The deadline alone is not a proof that the request stopped, a
 * request can outlive it when the provider is slow or when the request is
 * retried. The lease removes that doubt: while the request is running, the
 * deadline is moved forward, so the periodic recovery never releases the
 * credit of a running request.
 *
 * The lease has two ends:
 *
 * - the request ends, the lease stops and the credit of the request is
 *   returned when the deadline passes. A request that failed after the
 *   provider was called keeps its credit until then,
 * - the process dies, the lease is not renewed any more and the credit is
 *   returned when the deadline passes. A reservation is never held forever.
 */
export class ReservationLease {
  private timer: NodeJS.Timeout | undefined;
  private lastRenewedAt: number;
  private stopped = false;

  constructor(
    private readonly reservationId: string,
    private readonly reservations: IReservationService,
    private readonly options: ReservationLeaseOptions,
  ) {
    this.lastRenewedAt = Date.now();
  }

  /** Starts the renewal of the lease. The timer does not keep the process alive. */
  start(): void {
    if (this.timer || this.stopped) return;
    if (!Number.isSafeInteger(this.options.intervalMs) || this.options.intervalMs <= 0) {
      throw new Error('The reservation renewal interval must be a positive integer');
    }
    this.timer = setInterval(() => {
      void this.renew();
    }, this.options.intervalMs);
    this.timer.unref();
  }

  /**
   * Extends the lease once. The renewal fails when the reservation is not
   * reserved any more, the request has lost its credit guarantee then.
   */
  async renew(): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    try {
      const renewed = await this.reservations.renew(
        this.reservationId,
        new Date(now + this.options.lifetimeMs),
      );
      if (!renewed) {
        // The reservation was settled, released or recovered in the meantime.
        // The credit of the request is not held anymore.
        this.loseGuarantee('the reservation is no longer reserved');
        return;
      }
      this.lastRenewedAt = now;
    } catch (error) {
      // The lease ends at the last successful renewal plus its duration. The
      // next attempt has to happen before that moment, otherwise the recovery
      // can take the credit of a running request.
      const leaseEndsAt = this.lastRenewedAt + this.options.lifetimeMs;
      if (now + this.options.intervalMs >= leaseEndsAt) {
        this.loseGuarantee('the lease of the reservation could not be renewed');
        return;
      }
      this.options.logger?.error('The renewal of the credit reservation failed', {
        reservationId: this.reservationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Stops the renewal. The lease is not extended any more. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  private loseGuarantee(reason: string): void {
    if (this.stopped) return;
    this.stop();
    this.options.logger?.error('The credit guarantee of the request was lost', {
      reservationId: this.reservationId,
      reason,
    });
    this.options.onGuaranteeLost(reason);
  }
}
