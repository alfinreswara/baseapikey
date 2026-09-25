import { ValidationError } from '@baseapikey/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RegisterRequestSchema } from '../dto/register.dto';
import type { RegisterService } from '../services/register.service';

export class RegisterController {
  constructor(private readonly registerService: RegisterService) {}

  async handle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parseResult = RegisterRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      const issues = parseResult.error.errors.map((e: { message: string }) => e.message).join('; ');
      throw new ValidationError(`Validation failed: ${issues}`, {
        issues: parseResult.error.errors,
      });
    }

    const result = await this.registerService.register(parseResult.data);

    void reply.code(201).send({
      success: true,
      data: result,
    });
  }
}
