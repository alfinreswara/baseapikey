import { ValidationError } from '@baseapikey/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RefreshTokenRequestSchema } from '../dto/refresh.dto';
import type { RefreshTokenService } from '../services/refresh.service';

export class RefreshController {
  constructor(private readonly refreshService: RefreshTokenService) {}

  async handleRefresh(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parseResult = RefreshTokenRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      const message = issue ? issue.message : 'Invalid refresh token request';
      throw new ValidationError(message, parseResult.error.format());
    }

    const result = await this.refreshService.refreshToken(parseResult.data, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    });

    return reply.status(200).send({
      success: true,
      data: result,
    });
  }
}
