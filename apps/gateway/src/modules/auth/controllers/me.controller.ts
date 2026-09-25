import type { FastifyReply, FastifyRequest } from 'fastify';

import { getRequestUser } from '../middleware/auth.middleware';

export class MeController {
  async handleMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);

    return reply.status(200).send({
      success: true,
      data: {
        id: user.userId,
        email: user.email,
        role: user.role,
        sessionId: user.sessionId,
        tokenVersion: user.tokenVersion,
      },
    });
  }
}
