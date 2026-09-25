import { ValidationError } from '@baseapikey/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getRequestUser } from '../../auth/middleware/auth.middleware';
import {
  ApiKeyParamSchema,
  CreateApiKeySchema,
  UpdateApiKeyPermissionsSchema,
  UpdateApiKeySchema,
} from '../dto/create-api-key.dto';
import type { ApiKeyPermissionService } from '../services/api-key-permission.service';
import type { ApiKeyRevocationService } from '../services/api-key-revocation.service';
import type { ApiKeyRotationService } from '../services/api-key-rotation.service';
import type { ApiKeyService } from '../services/api-key.service';

export class ApiKeyController {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly apiKeyPermissionService?: ApiKeyPermissionService,
    private readonly apiKeyRotationService?: ApiKeyRotationService,
    private readonly apiKeyRevocationService?: ApiKeyRevocationService,
  ) {}

  async createApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // 1. Authenticate user context
    const user = getRequestUser(request);

    // 2. Validate request body against Zod schema
    const parseResult = CreateApiKeySchema.safeParse(request.body);
    if (!parseResult.success) {
      const issues = parseResult.error.errors.map((e) => e.message).join('; ');
      throw new ValidationError(`Validation failed: ${issues}`, {
        issues: parseResult.error.errors,
      });
    }
    const dto = parseResult.data;

    // 3. Extract request metadata
    const meta = {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    };

    // 4. Delegate to ApiKeyService
    const result = await this.apiKeyService.createApiKey(
      user.userId,
      dto,
      meta,
      user.activeOrganizationId,
    );

    // 5. Return HTTP 201 Created with response payload
    void reply.status(201).send({
      success: true,
      data: result,
    });
  }

  async listApiKeys(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const result = await this.apiKeyService.listApiKeys(user.userId, user.activeOrganizationId);
    void reply.status(200).send({
      success: true,
      data: result,
    });
  }

  async getApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const paramsResult = ApiKeyParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      const issues = paramsResult.error.errors.map((e) => e.message).join('; ');
      throw new ValidationError(`Invalid request parameters: ${issues}`, {
        issues: paramsResult.error.errors,
      });
    }

    const result = await this.apiKeyService.getApiKey(
      user.userId,
      paramsResult.data.id,
      user.activeOrganizationId,
    );
    void reply.status(200).send({
      success: true,
      data: result,
    });
  }

  async updateApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const paramsResult = ApiKeyParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      const issues = paramsResult.error.errors.map((e) => e.message).join('; ');
      throw new ValidationError(`Invalid request parameters: ${issues}`, {
        issues: paramsResult.error.errors,
      });
    }

    const bodyResult = UpdateApiKeySchema.safeParse(request.body);
    if (!bodyResult.success) {
      const issues = bodyResult.error.errors.map((e) => e.message).join('; ');
      throw new ValidationError(`Validation failed: ${issues}`, {
        issues: bodyResult.error.errors,
      });
    }

    const meta = {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    };

    const result = await this.apiKeyService.updateApiKey(
      user.userId,
      paramsResult.data.id,
      bodyResult.data,
      meta,
      user.activeOrganizationId,
    );

    void reply.status(200).send({
      success: true,
      data: result,
    });
  }

  async updateApiKeyPermissions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const paramsResult = ApiKeyParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      const issues = paramsResult.error.errors.map((e) => e.message).join('; ');
      throw new ValidationError(`Invalid request parameters: ${issues}`, {
        issues: paramsResult.error.errors,
      });
    }

    const bodyResult = UpdateApiKeyPermissionsSchema.safeParse(request.body);
    if (!bodyResult.success) {
      const issues = bodyResult.error.errors.map((e) => e.message).join('; ');
      throw new ValidationError(`Validation failed: ${issues}`, {
        issues: bodyResult.error.errors,
      });
    }

    const meta = {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    };

    if (!this.apiKeyPermissionService) {
      throw new Error('ApiKeyPermissionService is not injected in ApiKeyController');
    }

    const result = await this.apiKeyPermissionService.updatePermissions(
      user.userId,
      paramsResult.data.id,
      bodyResult.data,
      meta,
      user.activeOrganizationId,
    );

    void reply.status(200).send({
      success: true,
      data: result,
    });
  }

  async rotateApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const paramsResult = ApiKeyParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      const issues = paramsResult.error.errors.map((e) => e.message).join('; ');
      throw new ValidationError(`Invalid request parameters: ${issues}`, {
        issues: paramsResult.error.errors,
      });
    }

    const meta = {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    };

    if (!this.apiKeyRotationService) {
      throw new Error('ApiKeyRotationService is not injected in ApiKeyController');
    }

    const result = await this.apiKeyRotationService.rotateApiKey(
      user.userId,
      paramsResult.data.id,
      meta,
      user.activeOrganizationId,
    );

    void reply.status(200).send({
      success: true,
      data: result,
    });
  }

  async revokeApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const paramsResult = ApiKeyParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      const issues = paramsResult.error.errors.map((e) => e.message).join('; ');
      throw new ValidationError(`Invalid request parameters: ${issues}`, {
        issues: paramsResult.error.errors,
      });
    }

    const meta = {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    };

    let result;
    if (this.apiKeyRevocationService) {
      result = await this.apiKeyRevocationService.revokeApiKey(
        user.userId,
        paramsResult.data.id,
        meta,
        user.activeOrganizationId,
      );
    } else {
      const revoked = await this.apiKeyService.revokeApiKey(
        user.userId,
        paramsResult.data.id,
        meta,
        user.activeOrganizationId,
      );
      result = {
        success: true,
        message: 'API key revoked successfully.',
        data: revoked,
      };
    }

    void reply.status(200).send(result);
  }
}
