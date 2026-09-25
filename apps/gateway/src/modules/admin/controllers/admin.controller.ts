import type { FastifyReply, FastifyRequest } from 'fastify';

import { getRequestUser } from '../../auth/middleware/auth.middleware';
import { parseCursorPagination } from '../../common/pagination';
import {
  AdminIdParamsSchema,
  AuditQuerySchema,
  CreateModelSchema,
  CreateProviderSchema,
  parseAdminDto,
  UpdateModelSchema,
  UpdateProviderSchema,
} from '../dto/admin.dto';
import type { AdminService } from '../services/admin.service';

export class AdminController {
  constructor(private readonly service: AdminService) {}

  async listProviders(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const page = parseCursorPagination(request.query);
    const result = await this.service.listProviders(page.limit, page.cursor);
    this.send(reply, 200, result.data, { pagination: result.pagination });
  }

  async createProvider(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const dto = parseAdminDto(CreateProviderSchema, request.body);
    this.send(
      reply,
      201,
      await this.service.createProvider(user.userId, dto, this.metadata(request)),
    );
  }

  async updateProvider(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseAdminDto(AdminIdParamsSchema, request.params);
    const dto = parseAdminDto(UpdateProviderSchema, request.body);
    this.send(
      reply,
      200,
      await this.service.updateProvider(user.userId, id, dto, this.metadata(request)),
    );
  }

  async listModels(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const page = parseCursorPagination(request.query);
    const result = await this.service.listModels(page.limit, page.cursor);
    this.send(reply, 200, result.data, { pagination: result.pagination });
  }

  async createModel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const dto = parseAdminDto(CreateModelSchema, request.body);
    this.send(reply, 201, await this.service.createModel(user.userId, dto, this.metadata(request)));
  }

  async updateModel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseAdminDto(AdminIdParamsSchema, request.params);
    const dto = parseAdminDto(UpdateModelSchema, request.body);
    this.send(
      reply,
      200,
      await this.service.updateModel(user.userId, id, dto, this.metadata(request)),
    );
  }

  async listAudits(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = parseAdminDto(AuditQuerySchema, request.query);
    const result = await this.service.listAudits({ ...query, limit: query.limit ?? 20 });
    this.send(reply, 200, result.data, { pagination: result.pagination });
  }

  async listUsers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const page = parseCursorPagination(request.query);
    const search = (request.query as { search?: string }).search?.trim();
    const result = await this.service.listUsers(page.limit, page.cursor, search);
    this.send(reply, 200, result.data, { pagination: result.pagination });
  }

  async health(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    this.send(reply, 200, await this.service.getPlatformHealth());
  }

  async usage(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    this.send(reply, 200, await this.service.getPlatformUsage());
  }

  private metadata(request: FastifyRequest) {
    return { requestId: request.id, ipAddress: request.ip };
  }

  private send(
    reply: FastifyReply,
    statusCode: number,
    data: unknown,
    meta?: Record<string, unknown>,
  ): void {
    void reply
      .header('Cache-Control', 'private, no-store')
      .status(statusCode)
      .send({
        success: true,
        data,
        ...(meta ? { meta } : {}),
      });
  }
}
