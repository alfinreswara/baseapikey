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
  /** Stop advertising the instance as ready to receive new traffic. */
  markNotReady(): void;
  /** Stop background workers and flush the buffers they own. */
  stopBackgroundWork(): Promise<void>;
  /** Stop accepting connections and wait for in-flight requests to finish. */
  closeServer(): Promise<void>;
  /** Release database, cache, and other client connections. */
  closeResources(): Promise<void>;
}

export interface ShutdownCoordinatorOptions {
  hooks: ShutdownHooks;
  /** Time the instance keeps serving traffic while it drains. */
  drainDelayMs?: number;
  /** Hard budget for the whole shutdown sequence. */
  timeoutMs?: number;
  logger?: ShutdownLogger;
  /** Injectable delay, used by the tests to avoid real waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Invoked when the shutdown exceeds the timeout budget. */
  onTimeout?: () => void;
}

export interface ShutdownResult {
  status: 'clean' | 'failed';
  error?: unknown;
}

export const DEFAULT_SHUTDOWN_DRAIN_DELAY_MS = 10_000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

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

export class ShutdownCoordinator {
  private readonly hooks: ShutdownHooks;
  private readonly drainDelayMs: number;
  private readonly timeoutMs: number;
  private readonly logger: ShutdownLogger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onTimeout: () => void;
  private started = false;

  constructor(options: ShutdownCoordinatorOptions) {
    this.hooks = options.hooks;
    this.drainDelayMs = options.drainDelayMs ?? DEFAULT_SHUTDOWN_DRAIN_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
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

    try {
      this.hooks.markNotReady();
      if (this.drainDelayMs > 0) {
        this.logger.info(`Draining traffic for ${this.drainDelayMs}ms before closing`);
        await this.sleep(this.drainDelayMs);
      }
      await this.hooks.stopBackgroundWork();
      await this.hooks.closeServer();
      await this.hooks.closeResources();
      clearTimeout(forceTimer);
      this.logger.info('Shutdown completed cleanly');
      return { status: 'clean' };
    } catch (error) {
      clearTimeout(forceTimer);
      this.logger.error('Shutdown failed', {
        error: error instanceof Error ? error.message : error,
      });
      return { status: 'failed', error };
    }
  }
}
