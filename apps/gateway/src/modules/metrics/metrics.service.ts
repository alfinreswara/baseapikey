import type { FastifyInstance } from 'fastify';

interface MetricState {
  count: number;
  durationSeconds: number;
}

export class MetricsService {
  private readonly requests = new Map<string, MetricState>();
  private activeRequests = 0;

  registerHooks(app: FastifyInstance): void {
    app.addHook('onRequest', async () => {
      this.activeRequests += 1;
    });
    app.addHook('onResponse', async (request, reply) => {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      const route = request.routeOptions.url ?? 'unknown';
      const method = request.method;
      const status = String(reply.statusCode);
      const key = JSON.stringify([method, route, status]);
      const state = this.requests.get(key) ?? { count: 0, durationSeconds: 0 };
      state.count += 1;
      state.durationSeconds += reply.elapsedTime / 1000;
      this.requests.set(key, state);
    });
  }

  render(): string {
    const lines = [
      '# HELP baseapikey_active_requests Current number of in-flight HTTP requests.',
      '# TYPE baseapikey_active_requests gauge',
      `baseapikey_active_requests ${this.activeRequests}`,
      '# HELP baseapikey_http_requests_total Total HTTP requests.',
      '# TYPE baseapikey_http_requests_total counter',
    ];
    for (const [key, state] of this.requests) {
      const [method, route, status] = JSON.parse(key) as [string, string, string];
      const labels = `method="${this.escape(method)}",route="${this.escape(route)}",status="${this.escape(status)}"`;
      lines.push(`baseapikey_http_requests_total{${labels}} ${state.count}`);
    }
    lines.push(
      '# HELP baseapikey_http_request_duration_seconds_sum Accumulated HTTP request duration.',
      '# TYPE baseapikey_http_request_duration_seconds_sum counter',
    );
    for (const [key, state] of this.requests) {
      const [method, route, status] = JSON.parse(key) as [string, string, string];
      const labels = `method="${this.escape(method)}",route="${this.escape(route)}",status="${this.escape(status)}"`;
      lines.push(
        `baseapikey_http_request_duration_seconds_sum{${labels}} ${state.durationSeconds.toFixed(6)}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }

  private escape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}
