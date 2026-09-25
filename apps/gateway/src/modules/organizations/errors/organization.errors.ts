import { AppError } from '@baseapikey/shared';

export class OrganizationForbiddenError extends AppError {
  constructor(message = 'You do not have permission to manage this organization') {
    super('ORGANIZATION_FORBIDDEN', message, 403);
  }
}

export class OrganizationMemberConflictError extends AppError {
  constructor(message: string) {
    super('ORGANIZATION_MEMBER_CONFLICT', message, 409);
  }
}

export class LastOrganizationOwnerError extends AppError {
  constructor() {
    super('LAST_ORGANIZATION_OWNER', 'The last organization owner cannot be removed', 409);
  }
}
