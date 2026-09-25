import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import type { MetricsService } from './metrics.service';

export interface MetricsRoutesOptions extends FastifyPluginOptions {
  metricsService: MetricsService;
  token?: string | undefined;
}

export async function metricsRoutes(
  app: FastifyInstance,
  options: MetricsRoutesOptions,
): Promise<void> {
  app.get('/metrics', async (request, reply) => {
    if (options.token) {
      const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
      const expectedBuffer = Buffer.from(options.token);
      const suppliedBuffer = Buffer.from(supplied);
      if (
        expectedBuffer.length !== suppliedBuffer.length ||
        !timingSafeEqual(expectedBuffer, suppliedBuffer)
      ) {
        void reply.status(401).send('Unauthorized');
        return;
      }
    }
    void reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(options.metricsService.render());
  });
}
