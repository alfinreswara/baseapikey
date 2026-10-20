/**
 * Shared lifecycle state of a running Gateway instance.
 *
 * The state is created once during startup and handed to the HTTP layer and
 * to the provider layer. It answers two questions:
 *
 *   - May the instance accept new work? (`isDraining`)
 *   - Must the in-flight upstream requests be aborted? (`signal`)
 *
 * The abort signal is combined with the per request signal of every provider
 * call, so a single abort ends every long running upstream request. That is
 * what makes an endless stream terminate deterministically instead of being
 * cut off by the forced process exit.
 */
export class ServiceLifecycle {
  private draining = false;
  private readonly controller = new AbortController();

  /** Signal that is aborted when the instance has to terminate in-flight work. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** True once the shutdown started and new requests must be rejected. */
  get isDraining(): boolean {
    return this.draining;
  }

  /**
   * Marks the instance as draining. Readiness reports the instance as not
   * ready and the HTTP layer rejects new requests with 503.
   */
  beginDrain(): void {
    this.draining = true;
  }

  /**
   * Aborts every in-flight upstream request. Provider streams fail with an
   * abort error, the request handlers end their responses, and the HTTP
   * server can close.
   */
  abortInFlight(reason: string): void {
    if (this.controller.signal.aborted) {
      return;
    }
    this.controller.abort(new Error(reason));
  }
}
