export interface ErrorReport {
  service: string;
  environment: string;
  errorName: string;
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  occurredAt: string;
}

export interface IErrorReporter {
  capture(report: ErrorReport): void;
}

export class WebhookErrorReporter implements IErrorReporter {
  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly timeoutMs = 3_000,
  ) {}

  capture(report: ErrorReport): void {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    void fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'application_error', ...report }),
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => clearTimeout(timeout));
  }
}
