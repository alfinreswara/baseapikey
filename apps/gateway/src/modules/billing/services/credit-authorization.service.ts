import {
  BillingInsufficientCreditError,
  BillingReservationFailedError,
  BillingSpendingLimitReachedError,
} from '../errors/credit.errors';

import {
  CreditReservationError,
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

/**
 * Reserves the credit of a request before it is forwarded to a provider.
 *
 * The reservation is the authorization of the request: the request is only
 * sent to a provider when the organization has the credit for it. The
 * reservation is settled when the real usage is known.
 */
export class CreditAuthorizationService {
  constructor(private readonly reservations: IReservationService) {}

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
}
