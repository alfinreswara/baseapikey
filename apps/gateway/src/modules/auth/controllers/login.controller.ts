import { ValidationError } from '@baseapikey/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { LoginRequestSchema } from '../dto/login.dto';
import type { LoginService } from '../services/login.service';
import type { LoginMetadata } from '../types/auth.types';

export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  async handle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parseResult = LoginRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      const message = issue ? issue.message : 'Invalid login request';
      throw new ValidationError(message, parseResult.error.format());
    }

    const metadata: LoginMetadata = {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    };

    const loginResult = await this.loginService.login(parseResult.data, metadata);

    void reply.status(200).send({
      success: true,
      data: loginResult,
    });
  }
}
