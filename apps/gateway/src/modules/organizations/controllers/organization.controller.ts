import type { FastifyReply, FastifyRequest } from 'fastify';

import { getRequestUser } from '../../auth/middleware/auth.middleware';
import { parseCursorPagination } from '../../common/pagination';
import {
  CreateOrganizationSchema,
  InviteOrganizationMemberSchema,
  OrganizationIdParamsSchema,
  OrganizationMemberParamsSchema,
  OrganizationInvitationTokenParamsSchema,
  parseOrganizationDto,
  UpdateOrganizationMemberSchema,
  UpdateOrganizationSchema,
} from '../dto/organization.dto';
import type { OrganizationService } from '../services/organization.service';

export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}

  async listMine(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    this.send(reply, 200, await this.service.listForUser(user.userId));
  }

  async switchActive(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseOrganizationDto(OrganizationIdParamsSchema, request.params);
    await this.service.switchActiveOrganization(user.userId, id);
    this.send(reply, 200, { activeOrganizationId: id });
  }

  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const dto = parseOrganizationDto(CreateOrganizationSchema, request.body);
    this.send(
      reply,
      201,
      await this.service.createOrganization(user.userId, dto, this.metadata(request)),
    );
  }

  async get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseOrganizationDto(OrganizationIdParamsSchema, request.params);
    this.send(reply, 200, await this.service.getOrganization(user.userId, id));
  }

  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseOrganizationDto(OrganizationIdParamsSchema, request.params);
    const dto = parseOrganizationDto(UpdateOrganizationSchema, request.body);
    this.send(
      reply,
      200,
      await this.service.updateOrganization(user.userId, id, dto, this.metadata(request)),
    );
  }

  async listMembers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseOrganizationDto(OrganizationIdParamsSchema, request.params);
    const page = parseCursorPagination(request.query);
    const result = await this.service.listMembers(user.userId, id, page.limit, page.cursor);
    this.send(reply, 200, result.data, { pagination: result.pagination });
  }

  async inviteMember(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseOrganizationDto(OrganizationIdParamsSchema, request.params);
    const dto = parseOrganizationDto(InviteOrganizationMemberSchema, request.body);
    this.send(
      reply,
      201,
      await this.service.inviteMember(user.userId, id, dto, this.metadata(request)),
    );
  }

  async createInvitation(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseOrganizationDto(OrganizationIdParamsSchema, request.params);
    const dto = parseOrganizationDto(InviteOrganizationMemberSchema, request.body);
    this.send(
      reply,
      201,
      await this.service.createInvitation(user.userId, id, dto, this.metadata(request)),
    );
  }

  async acceptInvitation(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { token } = parseOrganizationDto(OrganizationInvitationTokenParamsSchema, request.params);
    this.send(reply, 200, await this.service.acceptInvitation(user.userId, user.email, token));
  }

  async updateMember(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id, userId } = parseOrganizationDto(OrganizationMemberParamsSchema, request.params);
    const dto = parseOrganizationDto(UpdateOrganizationMemberSchema, request.body);
    this.send(
      reply,
      200,
      await this.service.updateMember(user.userId, id, userId, dto, this.metadata(request)),
    );
  }

  async removeMember(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id, userId } = parseOrganizationDto(OrganizationMemberParamsSchema, request.params);
    await this.service.removeMember(user.userId, id, userId, this.metadata(request));
    void reply.status(204).send();
  }

  private metadata(request: FastifyRequest) {
    return {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    };
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
      .send({ success: true, data, ...(meta ? { meta } : {}) });
  }
}
