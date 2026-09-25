import { createHash, randomBytes } from 'node:crypto';

import { AuditSeverity, OrganizationRole } from '@baseapikey/database';
import { NotFoundError } from '@baseapikey/shared';

import { toCursorPage, type CursorPage } from '../../common/pagination';
import type {
  CreateOrganizationDto,
  InviteOrganizationMemberDto,
  UpdateOrganizationDto,
  UpdateOrganizationMemberDto,
} from '../dto/organization.dto';
import {
  LastOrganizationOwnerError,
  OrganizationForbiddenError,
  OrganizationMemberConflictError,
} from '../errors/organization.errors';
import type {
  IOrganizationRepository,
  OrganizationAuditData,
  OrganizationMembershipRecord,
  OrganizationRecord,
} from '../repositories/organization.repository';

import {
  type IOrganizationInvitationNotificationService,
  NoopOrganizationInvitationNotificationService,
} from './organization-invitation-notification.service';

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  billingEmail: string | null;
  plan: string;
  spendingLimitCents: number | null;
  isActive: boolean;
  isCurrent?: boolean | undefined;
  logoUrl: string | null;
  role?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMemberDto {
  id: string;
  userId: string;
  email: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  joinedAt: string | null;
}

export class OrganizationService {
  constructor(
    private readonly repository: IOrganizationRepository,
    private readonly invitationNotifications: IOrganizationInvitationNotificationService = new NoopOrganizationInvitationNotificationService(),
  ) {}

  async createInvitation(
    userId: string,
    organizationId: string,
    dto: InviteOrganizationMemberDto,
    metadata: Omit<OrganizationAuditData, 'organizationId' | 'userId' | 'action'>,
  ): Promise<Record<string, unknown>> {
    await this.requireManager(organizationId, userId);
    const organization = await this.requireOrganization(organizationId);
    if (await this.repository.findUserByEmail(dto.email)) {
      const member = await this.inviteMember(userId, organizationId, dto, metadata);
      return { ...member, invitationStatus: 'ACCEPTED' };
    }
    if (!this.repository.createInvitation) throw new Error('Invitation repository is unavailable');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invitation = await this.repository.createInvitation({
      organizationId,
      email: dto.email,
      role: dto.role ?? OrganizationRole.MEMBER,
      tokenHash,
      invitedById: userId,
      expiresAt,
    });
    await this.invitationNotifications.send({
      email: invitation.email,
      organizationName: organization.name,
      role: invitation.role,
      token,
      expiresAt,
    });
    await this.repository.recordAudit({
      organizationId,
      userId,
      action: 'ORGANIZATION_INVITATION_CREATE',
      resourceId: invitation.id,
      ...metadata,
      metadata: { email: invitation.email, role: invitation.role },
    });
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: 'PENDING',
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async acceptInvitation(
    userId: string,
    email: string,
    token: string,
  ): Promise<Record<string, unknown>> {
    if (!this.repository.acceptInvitation) throw new Error('Invitation repository is unavailable');
    const accepted = await this.repository.acceptInvitation({
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId,
      email,
    });
    if (!accepted) throw new NotFoundError('Organization invitation');
    await this.repository.setActiveOrganization(userId, accepted.organizationId);
    return { organizationId: accepted.organizationId, role: accepted.role, status: 'ACCEPTED' };
  }

  async listForUser(userId: string): Promise<OrganizationDto[]> {
    const [memberships, activeOrganizationId] = await Promise.all([
      this.repository.listForUser(userId),
      this.repository.getActiveOrganizationId?.(userId) ?? Promise.resolve(null),
    ]);
    return memberships
      .filter((membership) => membership.organization !== undefined)
      .map((membership) => ({
        ...this.toOrganizationDto(membership.organization!, membership.role),
        isCurrent: membership.organization!.id === activeOrganizationId,
      }));
  }

  async switchActiveOrganization(userId: string, organizationId: string): Promise<void> {
    await this.requireMembership(organizationId, userId);
    await this.repository.setActiveOrganization(userId, organizationId);
  }

  async createOrganization(
    userId: string,
    dto: CreateOrganizationDto,
    metadata: Omit<OrganizationAuditData, 'organizationId' | 'userId' | 'action'>,
  ): Promise<OrganizationDto> {
    const slug = dto.slug ?? this.createSlug(dto.name);
    const organization = await this.repository.createOrganization({
      ownerId: userId,
      name: dto.name,
      slug,
      billingEmail: dto.billingEmail,
    });
    await this.repository.recordAudit({
      organizationId: organization.id,
      userId,
      action: 'ORGANIZATION_CREATE',
      ...metadata,
      metadata: { slug },
    });
    return this.toOrganizationDto(organization, OrganizationRole.OWNER);
  }

  async getOrganization(userId: string, organizationId: string): Promise<OrganizationDto> {
    const membership = await this.requireManager(organizationId, userId);
    const organization = await this.requireOrganization(organizationId);
    return this.toOrganizationDto(organization, membership.role);
  }

  async updateOrganization(
    userId: string,
    organizationId: string,
    dto: UpdateOrganizationDto,
    metadata: Omit<OrganizationAuditData, 'organizationId' | 'userId' | 'action'>,
  ): Promise<OrganizationDto> {
    const membership = await this.requireMembership(organizationId, userId);
    if (membership.role !== OrganizationRole.OWNER) {
      throw new OrganizationForbiddenError('Only an organization owner can update settings');
    }
    const current = await this.requireOrganization(organizationId);
    const currentMetadata = this.asMetadata(current.metadata);
    const updated = await this.repository.updateOrganization(organizationId, {
      name: dto.name,
      billingEmail: dto.billingEmail,
      spendingLimitCents: dto.spendingLimitCents,
      ...(dto.logoUrl !== undefined
        ? { metadata: { ...currentMetadata, logoUrl: dto.logoUrl } }
        : {}),
    });
    await this.repository.recordAudit({
      organizationId,
      userId,
      action: 'ORGANIZATION_UPDATE',
      ...metadata,
      metadata: { fields: Object.keys(dto) },
    });
    return this.toOrganizationDto(updated, membership.role);
  }

  async listMembers(
    userId: string,
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<OrganizationMemberDto & { id: string }>> {
    await this.requireManager(organizationId, userId);
    const members = await this.repository.listMembers(organizationId, limit, cursor);
    return toCursorPage(
      members.map((member) => this.toMemberDto(member)),
      limit,
    );
  }

  async inviteMember(
    userId: string,
    organizationId: string,
    dto: InviteOrganizationMemberDto,
    metadata: Omit<OrganizationAuditData, 'organizationId' | 'userId' | 'action'>,
  ): Promise<OrganizationMemberDto> {
    const actor = await this.requireManager(organizationId, userId);
    const role = dto.role ?? OrganizationRole.MEMBER;
    if (actor.role === OrganizationRole.ADMIN && role !== OrganizationRole.MEMBER) {
      throw new OrganizationForbiddenError('Organization admins may only invite members');
    }
    const invitedUser = await this.repository.findUserByEmail(dto.email);
    if (!invitedUser) throw new NotFoundError('Registered user');
    if (await this.repository.findMembership(organizationId, invitedUser.id)) {
      throw new OrganizationMemberConflictError('User is already an organization member');
    }
    const member = await this.repository.addMember({
      organizationId,
      userId: invitedUser.id,
      role,
      invitedById: userId,
    });
    await this.repository.recordAudit({
      organizationId,
      userId,
      action: 'ORGANIZATION_MEMBER_ADD',
      resourceId: member.id,
      ...metadata,
      metadata: { memberUserId: member.userId, role: member.role },
    });
    return this.toMemberDto(member);
  }

  async updateMember(
    userId: string,
    organizationId: string,
    targetUserId: string,
    dto: UpdateOrganizationMemberDto,
    metadata: Omit<OrganizationAuditData, 'organizationId' | 'userId' | 'action'>,
  ): Promise<OrganizationMemberDto> {
    const actor = await this.requireManager(organizationId, userId);
    const organization = await this.requireOrganization(organizationId);
    const target = await this.requireMembership(organizationId, targetUserId);

    if (organization.ownerId === targetUserId && dto.role !== OrganizationRole.OWNER) {
      throw new LastOrganizationOwnerError();
    }
    if (
      actor.role === OrganizationRole.ADMIN &&
      (target.role === OrganizationRole.OWNER || dto.role === OrganizationRole.OWNER)
    ) {
      throw new OrganizationForbiddenError('Organization admins cannot manage owner roles');
    }
    if (
      target.role === OrganizationRole.OWNER &&
      dto.role !== OrganizationRole.OWNER &&
      (await this.repository.countOwners(organizationId)) <= 1
    ) {
      throw new LastOrganizationOwnerError();
    }

    const member = await this.repository.updateMemberRole(organizationId, targetUserId, dto.role);
    await this.repository.recordAudit({
      organizationId,
      userId,
      action: 'ORGANIZATION_MEMBER_ROLE_UPDATE',
      resourceId: member.id,
      ...metadata,
      metadata: { memberUserId: targetUserId, from: target.role, to: dto.role },
    });
    return this.toMemberDto(member);
  }

  async removeMember(
    userId: string,
    organizationId: string,
    targetUserId: string,
    metadata: Omit<OrganizationAuditData, 'organizationId' | 'userId' | 'action'>,
  ): Promise<void> {
    const actor = await this.requireManager(organizationId, userId);
    const organization = await this.requireOrganization(organizationId);
    const target = await this.requireMembership(organizationId, targetUserId);
    if (organization.ownerId === targetUserId) throw new LastOrganizationOwnerError();
    if (actor.role === OrganizationRole.ADMIN && target.role !== OrganizationRole.MEMBER) {
      throw new OrganizationForbiddenError('Organization admins may only remove members');
    }
    if (
      target.role === OrganizationRole.OWNER &&
      (await this.repository.countOwners(organizationId)) <= 1
    ) {
      throw new LastOrganizationOwnerError();
    }
    await this.repository.removeMember(organizationId, targetUserId);
    await this.repository.recordAudit({
      organizationId,
      userId,
      action: 'ORGANIZATION_MEMBER_REMOVE',
      resourceId: target.id,
      ...metadata,
      severity: AuditSeverity.WARNING,
      metadata: { memberUserId: targetUserId, role: target.role },
    });
  }

  private async requireOrganization(organizationId: string): Promise<OrganizationRecord> {
    const organization = await this.repository.findById(organizationId);
    if (!organization) throw new NotFoundError('Organization', organizationId);
    return organization;
  }

  private async requireMembership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembershipRecord> {
    const membership = await this.repository.findMembership(organizationId, userId);
    if (!membership) throw new OrganizationForbiddenError();
    return membership;
  }

  private async requireManager(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembershipRecord> {
    const membership = await this.requireMembership(organizationId, userId);
    if (membership.role !== OrganizationRole.OWNER && membership.role !== OrganizationRole.ADMIN) {
      throw new OrganizationForbiddenError();
    }
    return membership;
  }

  private createSlug(name: string): string {
    const base =
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'organization';
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  private toOrganizationDto(
    organization: OrganizationRecord,
    role?: OrganizationRole,
  ): OrganizationDto {
    const metadata = this.asMetadata(organization.metadata);
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      ownerId: organization.ownerId,
      billingEmail: organization.billingEmail,
      plan: organization.plan,
      spendingLimitCents: organization.spendingLimitCents,
      isActive: organization.isActive,
      logoUrl: typeof metadata['logoUrl'] === 'string' ? metadata['logoUrl'] : null,
      ...(role ? { role } : {}),
      createdAt: organization.createdAt.toISOString(),
      updatedAt: organization.updatedAt.toISOString(),
    };
  }

  private toMemberDto(
    member: OrganizationMembershipRecord,
  ): OrganizationMemberDto & { id: string } {
    return {
      id: member.id,
      userId: member.userId,
      email: member.user.email,
      username: member.user.username,
      fullName: member.user.fullName,
      avatarUrl: member.user.avatarUrl,
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt?.toISOString() ?? null,
    };
  }

  private asMetadata(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
