/**
 * The duration of the lease of a credit reservation.
 *
 * The lease is the deadline of the reservation. It is renewed while the
 * request is running, so the credit of a request is only returned when the
 * request can no longer be running. A request that outlives the lease keeps
 * its credit, the renewal extends the lease.
 */
export const RESERVATION_LIFETIME_MS = 120_000;

/**
 * The interval between two renewals of the lease. It has to be shorter than
 * the lease itself, so a failed renewal still leaves a window for the next
 * attempt.
 */
export const RESERVATION_RENEWAL_INTERVAL_MS = 30_000;

/**
 * The deadline of a request that reaches a provider.
 *
 * The provider timeout is a property of a single provider call. A request can
 * call more than one provider and every call can be retried, so the timeout of
 * the provider alone does not bound the lifetime of a request. The deadline
 * bounds the whole request.
 */
export const REQUEST_DEADLINE_MS = 300_000;
