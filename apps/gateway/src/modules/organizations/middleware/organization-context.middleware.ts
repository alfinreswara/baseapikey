import { OrganizationMemberStatus, prisma } from '@baseapikey/database';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import { UnauthorizedError } from '../../auth/errors/auth.errors';
import { getRequestUser } from '../../auth/middleware/auth.middleware';
import { OrganizationForbiddenError } from '../errors/organization.errors';

export interface OrganizationContext {
  organizationId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export interface IOrganizationContextResolver {
  resolve(userId: string): Promise<OrganizationContext | null>;
}

export class PrismaOrganizationContextResolver implements IOrganizationContextResolver {
  async resolve(userId: string): Promise<OrganizationContext | null> {
    const preference = await prisma.userOrganizationPreference.findUnique({
      where: { userId },
      select: {
        activeOrganizationId: true,
        activeOrganization: { select: { isActive: true, deletedAt: true } },
      },
    });
    if (!preference?.activeOrganization.isActive || preference.activeOrganization.deletedAt) {
      return null;
    }
    const membership = await prisma.organizationMember.findFirst({
      where: {
        userId,
        organizationId: preference.activeOrganizationId,
        status: OrganizationMemberStatus.ACTIVE,
      },
      select: { role: true },
    });
    if (!membership) return null;
    return { organizationId: preference.activeOrganizationId, role: membership.role };
  }
}

export function attachOrganizationContext(
  resolver: IOrganizationContextResolver,
): preHandlerHookHandler {
  return async (request: FastifyRequest): Promise<void> => {
    const user = getRequestUser(request);
    const context = await resolver.resolve(user.userId);
    if (!context) throw new UnauthorizedError('No active organization is available');
    user.activeOrganizationId = context.organizationId;
    user.organizationRole = context.role;
  };
}

export function requireOrganizationManager(): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = getRequestUser(request);
    if (user.organizationRole !== 'OWNER' && user.organizationRole !== 'ADMIN') {
      throw new OrganizationForbiddenError('Organization manager access is required');
    }
  };
}
