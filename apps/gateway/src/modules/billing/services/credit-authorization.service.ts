import {
  BillingInsufficientCreditError,
  BillingReservationFailedError,
  BillingSpendingLimitReachedError,
} from '../errors/credit.errors';

import { ReservationLease, type ReservationLeaseLogger } from './reservation-lease.service';
import {
  CreditReservationError,
  RESERVATION_LIFETIME_MS,
  RESERVATION_RENEWAL_INTERVAL_MS,
  type IReservationService,
  type ReservationModality,
} from './reservation.service';

export interface CreditAuthorizationInput {
  organizationId: string;
  apiKeyId: string | null;
  requestId: string;
  /** Identifies the request, a retry never reserves a second time. */
  idempotencyKey: string;
  modality: ReservationModality;
  /** The upper bound of the cost of the request, in micros. */
  amountMicros: number;
  /** The point in time at which the request can no longer be running. */
  expiresAt: Date;
}

export interface CreditAuthorizationOptions {
  /** The duration of the lease of a reservation. */
  leaseLifetimeMs?: number | undefined;
  /** The interval between two renewals of the lease. */
  leaseRenewalIntervalMs?: number | undefined;
  logger?: ReservationLeaseLogger | undefined;
}

/**
 * Reserves the credit of a request before it is forwarded to a provider.
 *
 * The reservation is the authorization of the request: the request is only
 * sent to a provider when the organization has the credit for it. The
 * reservation is settled when the real usage is known.
 */
export class CreditAuthorizationService {
  private readonly leaseLifetimeMs: number;
  private readonly leaseRenewalIntervalMs: number;

  constructor(
    private readonly reservations: IReservationService,
    private readonly options: CreditAuthorizationOptions = {},
  ) {
    this.leaseLifetimeMs = options.leaseLifetimeMs ?? RESERVATION_LIFETIME_MS;
    this.leaseRenewalIntervalMs = options.leaseRenewalIntervalMs ?? RESERVATION_RENEWAL_INTERVAL_MS;
  }

  async reserve(input: CreditAuthorizationInput): Promise<string | null> {
    try {
      const reservation = await this.reservations.reserve(input);
      return reservation.id;
    } catch (error) {
      if (error instanceof CreditReservationError) {
        if (error.code === 'INSUFFICIENT_CREDIT') {
          throw new BillingInsufficientCreditError(error.message, error.details);
        }
        if (error.code === 'SPENDING_LIMIT_REACHED') {
          throw new BillingSpendingLimitReachedError(error.message, error.details);
        }
        throw new BillingReservationFailedError(error.message, error.details);
      }
      throw error;
    }
  }

  /**
   * Returns the credit of a request that never reached the provider. The
   * request is not billed, the reservation leaves the state RELEASED.
   */
  async release(reservationId: string | null, reason: string): Promise<void> {
    if (!reservationId) return;
    try {
      await this.reservations.release(reservationId, reason);
    } catch {
      // The recovery of the expired reservations is the fallback, a failure
      // here must not break the response of the request.
    }
  }

  /**
   * Starts the lease of a reservation that is in use.
   *
   * The lease keeps the credit of a running request reserved, even when the
   * request outlives the original deadline. The caller stops the lease when
   * the request ends.
   */
  startLease(
    reservationId: string | null,
    onGuaranteeLost: (reason: string) => void,
  ): ReservationLease | null {
    if (!reservationId) return null;
    const lease = new ReservationLease(reservationId, this.reservations, {
      lifetimeMs: this.leaseLifetimeMs,
      intervalMs: this.leaseRenewalIntervalMs,
      onGuaranteeLost,
      ...(this.options.logger ? { logger: this.options.logger } : {}),
    });
    lease.start();
    return lease;
  }
}
