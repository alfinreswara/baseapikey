import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

export interface HealthRoutesOptions extends FastifyPluginOptions {
  healthService?: HealthService;
}

export async function healthRoutes(
  fastify: FastifyInstance,
  options: HealthRoutesOptions,
): Promise<void> {
  const healthService = options.healthService ?? new HealthService();
  const healthController = new HealthController(healthService);

  fastify.get('/health', (req, reply) => healthController.getHealth(req, reply));
  fastify.get('/health/live', (req, reply) => healthController.getLiveness(req, reply));
  fastify.get('/health/ready', (req, reply) => healthController.getReadiness(req, reply));
}
