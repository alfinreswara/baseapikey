import { ValidationError } from '@baseapikey/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { LogoutAllRequestSchema, LogoutRequestSchema } from '../dto/logout.dto';
import type { LogoutService } from '../services/logout.service';

export class LogoutController {
  constructor(private readonly logoutService: LogoutService) {}

  async handleLogout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parseResult = LogoutRequestSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      const message = issue ? issue.message : 'Invalid logout request';
      throw new ValidationError(message, parseResult.error.format());
    }

    await this.logoutService.logout(parseResult.data, request.headers.authorization, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    });

    return reply.status(204).send();
  }

  async handleLogoutAll(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parseResult = LogoutAllRequestSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      const message = issue ? issue.message : 'Invalid logout request';
      throw new ValidationError(message, parseResult.error.format());
    }

    await this.logoutService.logoutAll(parseResult.data, request.headers.authorization, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    });

    return reply.status(204).send();
  }
}
