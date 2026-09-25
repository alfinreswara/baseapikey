import type { FastifyReply, FastifyRequest } from 'fastify';

import { getRequestUser } from '../../auth/middleware/auth.middleware';
import { parseCursorPagination } from '../../common/pagination';
import {
  BillingOrganizationParamsSchema,
  BillingWebhookSchema,
  CreateCheckoutSchema,
  parseBillingDto,
} from '../dto/billing.dto';
import type { BillingService } from '../services/billing.service';

export class BillingController {
  constructor(private readonly service: BillingService) {}

  async getAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseBillingDto(BillingOrganizationParamsSchema, request.params);
    this.send(reply, 200, await this.service.getAccount(user.userId, id));
  }

  async listInvoices(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseBillingDto(BillingOrganizationParamsSchema, request.params);
    const page = parseCursorPagination(request.query);
    const result = await this.service.listInvoices(user.userId, id, page.limit, page.cursor);
    this.send(reply, 200, result.data, { pagination: result.pagination });
  }

  async listTransactions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseBillingDto(BillingOrganizationParamsSchema, request.params);
    const page = parseCursorPagination(request.query);
    const result = await this.service.listTransactions(user.userId, id, page.limit, page.cursor);
    this.send(reply, 200, result.data, { pagination: result.pagination });
  }

  async createCheckout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const { id } = parseBillingDto(BillingOrganizationParamsSchema, request.params);
    const dto = parseBillingDto(CreateCheckoutSchema, request.body);
    this.send(reply, 201, await this.service.createCheckout(user.userId, id, dto));
  }

  async webhook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const provider = (request.params as { provider?: string }).provider ?? 'unknown';
    const signatureHeader = request.headers['x-billing-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const dto = parseBillingDto(BillingWebhookSchema, request.body);
    this.send(reply, 200, await this.service.processWebhook(provider, signature, dto));
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
