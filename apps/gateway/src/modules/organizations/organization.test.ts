import assert from 'node:assert/strict';

import { OrganizationMemberStatus, OrganizationPlan, OrganizationRole } from '@baseapikey/database';

import {
  LastOrganizationOwnerError,
  OrganizationForbiddenError,
} from './errors/organization.errors';
import type {
  IOrganizationRepository,
  OrganizationMembershipRecord,
  OrganizationRecord,
} from './repositories/organization.repository';
import { OrganizationService } from './services/organization.service';

const now = new Date('2026-09-19T00:00:00.000Z');
const organization: OrganizationRecord = {
  id: 'organization-id',
  name: 'Example Team',
  slug: 'example-team',
  ownerId: 'owner-id',
  billingEmail: null,
  plan: OrganizationPlan.FREE,
  spendingLimitCents: null,
  isActive: true,
  metadata: {},
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

function membership(userId: string, role: OrganizationRole): OrganizationMembershipRecord {
  return {
    id: `membership-${userId}`,
    organizationId: organization.id,
    userId,
    role,
    status: OrganizationMemberStatus.ACTIVE,
    joinedAt: now,
    createdAt: now,
    user: {
      email: `${userId}@example.com`,
      username: userId,
      fullName: userId,
      avatarUrl: null,
    },
  };
}

const members = new Map<string, OrganizationMembershipRecord>([
  ['owner-id', membership('owner-id', OrganizationRole.OWNER)],
  ['admin-id', membership('admin-id', OrganizationRole.ADMIN)],
  ['member-id', membership('member-id', OrganizationRole.MEMBER)],
]);
let storedInvitationHash = '';
let deliveredInvitationToken = '';

const repository: IOrganizationRepository = {
  getActiveOrganizationId: async () => organization.id,
  listForUser: async (userId) => {
    const record = members.get(userId);
    return record ? [{ ...record, organization }] : [];
  },
  findById: async (id) => (id === organization.id ? organization : null),
  findMembership: async (_organizationId, userId) => members.get(userId) ?? null,
  createOrganization: async () => organization,
  updateOrganization: async (_id, data) => ({
    ...organization,
    name: data.name ?? organization.name,
    billingEmail: data.billingEmail === undefined ? organization.billingEmail : data.billingEmail,
    spendingLimitCents:
      data.spendingLimitCents === undefined
        ? organization.spendingLimitCents
        : data.spendingLimitCents,
    plan: data.plan ?? organization.plan,
    metadata: data.metadata ?? organization.metadata,
  }),
  setActiveOrganization: async () => undefined,
  findUserByEmail: async (email) => (email === 'new@example.com' ? { id: 'new-id', email } : null),
  listMembers: async () => [...members.values()],
  addMember: async (data) => {
    const record = membership(data.userId, data.role);
    members.set(data.userId, record);
    return record;
  },
  updateMemberRole: async (_organizationId, userId, role) => {
    const record = { ...members.get(userId)!, role };
    members.set(userId, record);
    return record;
  },
  removeMember: async (_organizationId, userId) => {
    members.delete(userId);
  },
  countOwners: async () =>
    [...members.values()].filter((record) => record.role === OrganizationRole.OWNER).length,
  recordAudit: async () => undefined,
  createInvitation: async (data) => {
    storedInvitationHash = data.tokenHash;
    return {
      id: 'invitation-id',
      email: data.email,
      role: data.role,
      expiresAt: data.expiresAt,
    };
  },
  acceptInvitation: async (data) =>
    data.tokenHash.length === 64
      ? { organizationId: organization.id, role: OrganizationRole.MEMBER }
      : null,
};

async function run(): Promise<void> {
  const service = new OrganizationService(repository);
  const owned = await service.listForUser('owner-id');
  assert.equal(owned[0]?.role, OrganizationRole.OWNER);
  assert.equal(owned[0]?.isCurrent, true);

  const invited = await service.inviteMember(
    'owner-id',
    organization.id,
    { email: 'new@example.com' },
    {},
  );
  assert.equal(invited.role, OrganizationRole.MEMBER);

  await assert.rejects(
    service.inviteMember(
      'admin-id',
      organization.id,
      { email: 'new@example.com', role: OrganizationRole.ADMIN },
      {},
    ),
    OrganizationForbiddenError,
  );
  await assert.rejects(
    service.removeMember('owner-id', organization.id, 'owner-id', {}),
    LastOrganizationOwnerError,
  );
  await assert.rejects(
    service.listMembers('member-id', organization.id, 20),
    OrganizationForbiddenError,
  );
  const invitationService = new OrganizationService(repository, {
    send: async (notification) => {
      deliveredInvitationToken = notification.token;
    },
  });
  const pending = await invitationService.createInvitation(
    'owner-id',
    organization.id,
    { email: 'pending@example.com' },
    {},
  );
  assert.equal(pending['status'], 'PENDING');
  assert.match(storedInvitationHash, /^[a-f0-9]{64}$/);
  assert.equal(storedInvitationHash.includes(deliveredInvitationToken), false);
  const accepted = await invitationService.acceptInvitation(
    'pending-id',
    'pending@example.com',
    deliveredInvitationToken,
  );
  assert.equal(accepted['status'], 'ACCEPTED');
  console.log('✅ Organization membership, RBAC, and owner-safety tests passed');
}

void run();
