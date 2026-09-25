import type { FastifyReply, FastifyRequest } from 'fastify';

import { HealthService } from './health.service';

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  async getHealth(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const health = this.healthService.getHealth();
    return reply.status(200).send(health);
  }

  async getLiveness(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const liveness = this.healthService.getLiveness();
    return reply.status(200).send(liveness);
  }

  async getReadiness(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const readiness = await this.healthService.getReadiness();
    const statusCode = readiness.ready ? 200 : 503;
    return reply.status(statusCode).send(readiness);
  }
}
