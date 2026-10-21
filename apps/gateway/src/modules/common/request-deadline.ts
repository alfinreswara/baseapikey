/**
 * The deadline of a request that reaches a provider.
 *
 * The provider timeout is a property of a single provider call. A request can
 * call more than one provider and every call can be retried, so the timeout of
 * the provider alone does not bound the lifetime of a request. The deadline
 * bounds the whole request, it is enforced with an abort signal.
 *
 * The deadline is also the upper bound of the lease of the credit reservation
 * of the request: the credit of a request is held while the request runs and
 * it is returned when the request ended.
 */
export { REQUEST_DEADLINE_MS as DEFAULT_REQUEST_DEADLINE_MS } from '@baseapikey/shared';

/**
 * Creates the abort controller of a request with its deadline.
 *
 * The controller is aborted when the deadline is reached. The reason contains
 * the word timeout, the provider maps it to a timeout error.
 */
export function createRequestDeadline(deadlineMs: number): {
  controller: AbortController;
  cancel: () => void;
} {
  const controller = new AbortController();
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error('The request deadline must be a positive integer');
  }
  const timer = setTimeout(() => {
    controller.abort(new Error('The request exceeded the deadline of the gateway (timeout)'));
  }, deadlineMs);
  // The timer must not keep the process alive, the shutdown ends the request.
  timer.unref();
  return {
    controller,
    cancel: () => {
      clearTimeout(timer);
    },
  };
}
