import { ValidationError } from '@baseapikey/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { DeleteSessionQuerySchema, SessionParamsSchema } from '../dto/session.dto';
import { getRequestUser } from '../middleware/auth.middleware';
import type { SessionService } from '../services/session.service';

export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  async listSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const sessions = await this.sessionService.listActiveSessions(user.userId, user.sessionId);

    return reply.status(200).send({
      success: true,
      data: sessions,
    });
  }

  async getSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const parseResult = SessionParamsSchema.safeParse(request.params);

    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      throw new ValidationError(
        issue ? issue.message : 'Invalid session params',
        parseResult.error.format(),
      );
    }

    const session = await this.sessionService.getSessionDetail(
      user.userId,
      parseResult.data.id,
      user.sessionId,
    );

    return reply.status(200).send({
      success: true,
      data: session,
    });
  }

  async revokeSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const parseParams = SessionParamsSchema.safeParse(request.params);

    if (!parseParams.success) {
      const issue = parseParams.error.issues[0];
      throw new ValidationError(
        issue ? issue.message : 'Invalid session params',
        parseParams.error.format(),
      );
    }

    const parseQuery = DeleteSessionQuerySchema.safeParse(request.query ?? {});
    const confirm = parseQuery.success ? parseQuery.data.confirm : undefined;

    await this.sessionService.revokeSession(
      user.userId,
      parseParams.data.id,
      user.sessionId,
      confirm,
      {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
      },
    );

    return reply.status(200).send({
      success: true,
      data: {
        message: 'Session revoked successfully',
      },
    });
  }
}
