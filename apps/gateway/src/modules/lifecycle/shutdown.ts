export interface ShutdownLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Ordered shutdown steps of a long running HTTP service.
 *
 * The runtime image of the Gateway is distroless and contains no shell, so
 * Kubernetes cannot run a shell based `preStop` hook. The process therefore
 * owns the whole termination sequence and reacts to the SIGTERM that
 * Kubernetes sends to PID 1.
 */
export interface ShutdownHooks {
  /** Stop advertising the instance as ready and reject new requests. */
  markNotReady(): void;
  /** Stop background workers and flush the buffers they own. */
  stopBackgroundWork(): Promise<void>;
  /** Stop accepting connections and wait for in-flight requests to finish. */
  closeServer(): Promise<void>;
  /** Release database, cache, and other client connections. */
  closeResources(): Promise<void>;
  /**
   * Aborts the in-flight upstream requests. Long running streams end with an
   * error event instead of being cut off by the forced process exit.
   */
  abortInFlightRequests?(): void;
  /**
   * Destroys the remaining sockets when the server refuses to close. This is
   * the last resort before the process is terminated.
   */
  forceCloseServer?(): void;
}

export interface ShutdownCoordinatorOptions {
  hooks: ShutdownHooks;
  /** Time the instance keeps serving traffic while it drains. */
  drainDelayMs?: number;
  /** Hard budget for the whole shutdown sequence. */
  timeoutMs?: number;
  /** Extra time the in-flight requests may take after they were aborted. */
  forceGraceMs?: number;
  /** Time that is kept for closing the database and cache connections. */
  resourceReserveMs?: number;
  logger?: ShutdownLogger;
  /** Injectable delay, used by the tests to avoid real waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Invoked when the shutdown exceeds the timeout budget. */
  onTimeout?: () => void;
}

export type ShutdownStatus = 'clean' | 'forced' | 'failed';

export interface ShutdownResult {
  status: ShutdownStatus;
  error?: unknown;
}

export const DEFAULT_SHUTDOWN_DRAIN_DELAY_MS = 10_000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;
export const DEFAULT_SHUTDOWN_FORCE_GRACE_MS = 2_000;
export const DEFAULT_SHUTDOWN_RESOURCE_RESERVE_MS = 5_000;

const consoleLogger: ShutdownLogger = {
  info(message, context) {
    if (context) {
      console.log(message, context);
      return;
    }
    console.log(message);
  },
  error(message, context) {
    if (context) {
      console.error(message, context);
      return;
    }
    console.error(message);
  },
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // The timer stays referenced on purpose: the process must not exit while
    // it is still draining traffic.
    setTimeout(resolve, ms);
  });
}

/**
 * Ends the process after a finished shutdown. The exit code is set first so
 * a process that exits on its own reports the same result, and the forced
 * exit only runs when a keep-alive connection keeps the event loop alive.
 */
export function scheduleProcessExit(code: number, delayMs = 1_000): void {
  process.exitCode = code;
  const timer = setTimeout(() => process.exit(code), delayMs);
  timer.unref();
}

/**
 * Runs the shutdown sequence of the Gateway.
 *
 * The sequence has four phases and every phase is bounded, so an unresponsive
 * Redis or provider can never block the shutdown forever:
 *
 *   1. Drain: the instance reports itself as not ready and rejects new
 *      requests, while the requests that are already running keep their
 *      connections and may finish their work.
 *   2. Background work: the workers stop and flush their buffers.
 *   3. Server close: the server stops accepting connections and waits for the
 *      in-flight requests. When they do not finish in time, the upstream
 *      requests are aborted so that the streams end with an error event
 *      instead of being cut off. Only if that does not help either, the
 *      remaining sockets are destroyed.
 *   4. Resources: the database and cache connections are closed.
 *
 * The result reports whether the shutdown was clean, forced (something had to
 * be aborted) or failed.
 */
export class ShutdownCoordinator {
  private readonly hooks: ShutdownHooks;
  private readonly drainDelayMs: number;
  private readonly timeoutMs: number;
  private readonly forceGraceMs: number;
  private readonly resourceReserveMs: number;
  private readonly logger: ShutdownLogger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onTimeout: () => void;
  private started = false;

  constructor(options: ShutdownCoordinatorOptions) {
    this.hooks = options.hooks;
    this.drainDelayMs = options.drainDelayMs ?? DEFAULT_SHUTDOWN_DRAIN_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.forceGraceMs = options.forceGraceMs ?? DEFAULT_SHUTDOWN_FORCE_GRACE_MS;
    this.resourceReserveMs = options.resourceReserveMs ?? DEFAULT_SHUTDOWN_RESOURCE_RESERVE_MS;
    this.logger = options.logger ?? consoleLogger;
    this.sleep = options.sleep ?? defaultSleep;
    this.onTimeout =
      options.onTimeout ??
      (() => {
        process.exit(1);
      });
  }

  /**
   * Runs the shutdown sequence once. Repeated signals are ignored so a
   * second SIGTERM cannot interrupt the cleanup that is already running.
   */
  async shutdown(signal: string): Promise<ShutdownResult> {
    if (this.started) {
      this.logger.info(`Shutdown already in progress, ignoring ${signal}`);
      return { status: 'clean' };
    }
    this.started = true;

    const forceTimer = setTimeout(() => {
      this.logger.error(`Shutdown timed out after ${this.timeoutMs}ms`);
      this.onTimeout();
    }, this.timeoutMs);
    forceTimer.unref();

    const deadline = Date.now() + this.timeoutMs;
    let status: ShutdownStatus = 'clean';
    let failure: unknown;

    try {
      this.hooks.markNotReady();

      if (this.drainDelayMs > 0) {
        const drainMs = Math.max(0, Math.min(this.drainDelayMs, deadline - Date.now()));
        this.logger.info(`Draining traffic for ${drainMs}ms before closing`);
        await this.sleep(drainMs);
      }

      const workDeadline = deadline - this.resourceReserveMs;
      const background = await this.awaitBounded(
        'Stopping the background workers',
        this.hooks.stopBackgroundWork(),
        workDeadline,
      );
      if (!background.completed) {
        status = 'forced';
      }
      if (background.error) {
        failure = background.error;
        status = 'failed';
      }

      const closing = this.hooks.closeServer();
      let server = await this.awaitBounded('Closing the HTTP server', closing, workDeadline);
      if (!server.completed) {
        // The in-flight requests did not finish in time. They are aborted so
        // that the streams end with an error event instead of being cut off
        // by the forced process exit.
        status = 'forced';
        this.logger.info('The HTTP server did not close in time, aborting in-flight requests');
        this.hooks.abortInFlightRequests?.();
        server = await this.awaitBounded(
          'Closing the HTTP server after the abort',
          closing,
          Date.now() + this.forceGraceMs,
        );
        if (!server.completed) {
          this.logger.error('The HTTP server did not close, destroying the remaining connections');
          this.hooks.forceCloseServer?.();
          server = await this.awaitBounded(
            'Closing the HTTP server after the forced close',
            closing,
            Date.now() + this.forceGraceMs,
          );
        }
      }
      if (server.error) {
        failure = failure ?? server.error;
        status = 'failed';
      }

      const resources = await this.awaitBounded(
        'Closing the database and cache connections',
        this.hooks.closeResources(),
        deadline,
      );
      if (!resources.completed) {
        status = 'forced';
      }
      if (resources.error) {
        failure = failure ?? resources.error;
        status = 'failed';
      }

      if (status === 'clean') {
        this.logger.info('Shutdown completed cleanly');
      } else if (status === 'forced') {
        this.logger.info('Shutdown completed with forced terminations');
      } else {
        this.logger.error('Shutdown failed', {
          error: failure instanceof Error ? failure.message : failure,
        });
      }
      return { status, ...(failure !== undefined ? { error: failure } : {}) };
    } catch (error) {
      this.logger.error('Shutdown failed', {
        error: error instanceof Error ? error.message : error,
      });
      return { status: 'failed', error };
    } finally {
      clearTimeout(forceTimer);
    }
  }

  /**
   * Waits for an operation until the deadline. The operation keeps running in
   * the background when the deadline passes, but the shutdown continues with
   * the next phase instead of waiting forever.
   */
  private async awaitBounded(
    label: string,
    operation: Promise<void>,
    deadline: number,
  ): Promise<{ completed: boolean; error?: unknown }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      // The timer stays referenced on purpose: the process must not exit
      // while a shutdown phase is still waiting for its deadline.
      timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()));
    });
    const settled = operation.then(
      () => ({ completed: true, error: undefined }) as { completed: boolean; error?: unknown },
      (error: unknown) => ({ completed: false, error }) as { completed: boolean; error?: unknown },
    );
    try {
      const outcome = await Promise.race([settled, timeout]);
      if (outcome === 'timeout') {
        this.logger.error(`${label} did not finish before the deadline`);
        return { completed: false };
      }
      if (outcome.error) {
        this.logger.error(`${label} failed`, {
          error: outcome.error instanceof Error ? outcome.error.message : outcome.error,
        });
        return { completed: false, error: outcome.error };
      }
      return { completed: true };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
