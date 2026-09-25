# BaseAPIKey — Coding Standards

> **Version:** 1.0
> **Last Updated:** 2026-08-06
> **Status:** Draft
> **Author:** Architecture Team

---

## Table of Contents

1. [TypeScript Conventions](#1-typescript-conventions)
2. [Folder Naming](#2-folder-naming)
3. [File Naming](#3-file-naming)
4. [API Conventions](#4-api-conventions)
5. [Error Handling](#5-error-handling)
6. [Logging](#6-logging)
7. [Security Rules](#7-security-rules)
8. [Clean Architecture Rules](#8-clean-architecture-rules)
9. [SOLID Principles](#9-solid-principles)

---

## 1. TypeScript Conventions

### 1.1 Strict Mode

TypeScript strict mode is **mandatory** across all packages. The base `tsconfig.json` enforces:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "exactOptionalPropertyTypes": true,
  },
}
```

### 1.2 Types vs. Interfaces

| Use         | Construct                            | When                                                        |
| ----------- | ------------------------------------ | ----------------------------------------------------------- |
| `interface` | Object shapes, class contracts       | DTOs, entity shapes, repository contracts, port definitions |
| `type`      | Unions, intersections, utility types | Discriminated unions, mapped types, conditional types       |

```typescript
// ✅ GOOD — interface for object shapes
interface User {
  readonly id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

// ✅ GOOD — interface for contracts/ports
interface IApiKeyRepository {
  findByHash(hash: string): Promise<ApiKey | null>;
  create(data: CreateApiKeyDto): Promise<ApiKey>;
  revoke(id: string): Promise<void>;
}

// ✅ GOOD — type for unions and utilities
type UserRole = 'admin' | 'user';
type ProviderHealth = 'healthy' | 'degraded' | 'down';
type Nullable<T> = T | null;
type CreateInput<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;
```

### 1.3 Explicit Return Types

All exported functions and public methods **must** have explicit return types:

```typescript
// ✅ GOOD — explicit return type
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// ✅ GOOD — async return type
export async function findUserByEmail(email: string): Promise<User | null> {
  return db.query.users.findFirst({ where: eq(users.email, email) });
}

// ❌ BAD — implicit return type on exported function
export function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}
```

Private/internal helper functions may use type inference.

### 1.4 Immutability

Use `readonly` for properties that should not be mutated after creation:

```typescript
// ✅ GOOD — readonly for entity properties
interface ApiKeyEntity {
  readonly id: string;
  readonly keyHash: string;
  readonly organizationId: string;
  readonly createdAt: Date;
  name: string; // mutable — can be renamed
  isActive: boolean; // mutable — can be revoked
}

// ✅ GOOD — readonly arrays
function getActiveModels(): readonly Model[] {
  return models.filter((m) => m.isActive);
}
```

### 1.5 Avoid `any`

**Never** use `any`. Use `unknown` when the type is truly unknown, then narrow with type guards:

```typescript
// ❌ BAD — any silences all type checking
function parseResponse(data: any) {
  return data.choices[0].message;
}

// ✅ GOOD — unknown with type guard
function parseResponse(data: unknown): ChatMessage {
  if (!isChatCompletionResponse(data)) {
    throw new ProviderError('Invalid response format');
  }
  return data.choices[0].message;
}

// ✅ GOOD — type guard
function isChatCompletionResponse(data: unknown): data is ChatCompletionResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'choices' in data &&
    Array.isArray((data as Record<string, unknown>).choices)
  );
}
```

### 1.6 Constants with `as const`

Prefer `as const` objects over TypeScript `enum`:

```typescript
// ✅ GOOD — const object + type extraction
export const ERROR_CODES = {
  INVALID_API_KEY: 'INVALID_API_KEY',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SPENDING_LIMIT_EXCEEDED: 'SPENDING_LIMIT_EXCEEDED',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ❌ BAD — TypeScript enum (generates extra runtime code, harder to tree-shake)
enum ErrorCode {
  INVALID_API_KEY = 'INVALID_API_KEY',
  // ...
}
```

### 1.7 Result Pattern

Use a typed `Result<T, E>` pattern for operations that can fail predictably:

```typescript
// Result type definition
type Result<T, E = AppError> = { success: true; data: T } | { success: false; error: E };

// ✅ GOOD — explicit success/failure handling
async function validateApiKey(rawKey: string): Promise<Result<ApiKeyContext, AuthenticationError>> {
  const hash = hashApiKey(rawKey);
  const apiKey = await apiKeyRepo.findByHash(hash);

  if (!apiKey) {
    return { success: false, error: new AuthenticationError('Invalid API key') };
  }

  if (!apiKey.isActive) {
    return { success: false, error: new AuthenticationError('API key has been revoked') };
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return { success: false, error: new AuthenticationError('API key has expired') };
  }

  return { success: true, data: { apiKey, organizationId: apiKey.organizationId } };
}

// Usage — caller is forced to handle both cases
const result = await validateApiKey(token);
if (!result.success) {
  return reply.code(401).send({ error: result.error.toJSON() });
}
const { apiKey, organizationId } = result.data;
```

### 1.8 Discriminated Unions

Use discriminated unions for state machines and variant types:

```typescript
// ✅ GOOD — discriminated union for provider health
type ProviderHealthStatus =
  | { status: 'healthy'; lastCheckedAt: Date }
  | { status: 'degraded'; lastCheckedAt: Date; latencyMs: number }
  | { status: 'down'; lastCheckedAt: Date; error: string };

function handleHealth(health: ProviderHealthStatus): void {
  switch (health.status) {
    case 'healthy':
      // TypeScript knows lastCheckedAt is available
      break;
    case 'degraded':
      // TypeScript knows latencyMs is available
      logger.warn({ latencyMs: health.latencyMs }, 'Provider degraded');
      break;
    case 'down':
      // TypeScript knows error is available
      logger.error({ error: health.error }, 'Provider down');
      break;
  }
}
```

### 1.9 Naming Conventions

| Element               | Convention                             | Example                                       |
| --------------------- | -------------------------------------- | --------------------------------------------- |
| Types / Interfaces    | PascalCase                             | `User`, `ApiKeyEntity`, `IProviderAdapter`    |
| Interface prefixes    | `I` prefix for ports/contracts         | `IApiKeyRepository`, `IRateLimiter`           |
| Classes               | PascalCase                             | `NineRouterAdapter`, `ChatCompletionUseCase`  |
| Variables / Functions | camelCase                              | `apiKey`, `hashApiKey()`, `findUserByEmail()` |
| Constants             | UPPER_SNAKE_CASE                       | `MAX_RETRIES`, `DEFAULT_RPM`, `ERROR_CODES`   |
| Enums (as const)      | UPPER_SNAKE_CASE keys                  | `ERROR_CODES.INVALID_API_KEY`                 |
| Generic parameters    | Single uppercase letter or descriptive | `T`, `TInput`, `TOutput`                      |
| Boolean variables     | `is`, `has`, `should`, `can` prefix    | `isActive`, `hasExpired`, `shouldRetry`       |

---

## 2. Folder Naming

### 2.1 General Rules

- All folder names are **lowercase**
- Multi-word folder names use **kebab-case**: `rate-limit`, `use-cases`, `value-objects`
- **Never** use camelCase or PascalCase for folders
- Feature-based organization within each Clean Architecture layer

### 2.2 Clean Architecture Layer Structure

```
apps/gateway/src/
├── domain/                    # Layer 0 — No dependencies
│   ├── entities/              # Business objects with identity
│   ├── value-objects/         # Immutable domain primitives
│   └── errors/                # Domain-specific error types
│
├── application/               # Layer 1 — Depends on domain only
│   ├── use-cases/             # Business logic orchestration
│   ├── ports/                 # Interfaces for infrastructure
│   ├── dtos/                  # Data transfer objects
│   └── services/              # Application services
│
├── infrastructure/            # Layer 2 — Implements application ports
│   ├── database/              # Repository implementations
│   ├── providers/             # AI provider adapters
│   ├── cache/                 # Redis implementations
│   └── queue/                 # Async job processing
│
├── presentation/              # Layer 2 — HTTP/transport layer
│   ├── routes/                # Route definitions
│   ├── controllers/           # Request handlers
│   ├── middleware/             # HTTP middleware
│   └── validators/            # Zod request schemas
│
└── config/                    # Application configuration
```

### 2.3 Dashboard Structure

```
apps/dashboard/src/
├── app/                       # Next.js App Router pages
│   ├── (auth)/                # Auth route group (unprotected)
│   │   ├── login/
│   │   └── register/
│   ├── (dashboard)/           # Dashboard route group (protected)
│   │   ├── keys/
│   │   ├── usage/
│   │   ├── models/
│   │   ├── settings/
│   │   └── admin/
│   └── api/                   # API routes
├── components/
│   ├── ui/                    # Base UI components
│   ├── charts/                # Chart components
│   ├── forms/                 # Form components
│   └── layout/                # Layout components
├── hooks/                     # Custom React hooks
├── lib/                       # Client utilities
└── styles/                    # CSS styles
```

### 2.4 Test File Location

Test files are **co-located** with the source files they test:

```
use-cases/
├── chat-completion.use-case.ts
├── chat-completion.use-case.test.ts     # Unit test
├── list-models.use-case.ts
└── list-models.use-case.test.ts
```

---

## 3. File Naming

### 3.1 General Rules

- All file names are **kebab-case**: `chat-completion.controller.ts`
- **Never** use camelCase or PascalCase for file names
- Files have **role-based suffixes** that indicate their purpose
- One **primary export** per file (types/constants files may have multiple)

### 3.2 Suffix Conventions

| Suffix           | Layer          | Purpose                  | Example                            |
| ---------------- | -------------- | ------------------------ | ---------------------------------- |
| `.entity.ts`     | Domain         | Domain entity            | `api-key.entity.ts`                |
| `.vo.ts`         | Domain         | Value object             | `token-count.vo.ts`                |
| `.error.ts`      | Domain/Shared  | Custom error class       | `spending-limit-exceeded.error.ts` |
| `.use-case.ts`   | Application    | Use case orchestration   | `chat-completion.use-case.ts`      |
| `.port.ts`       | Application    | Interface definition     | `provider-adapter.port.ts`         |
| `.dto.ts`        | Application    | Data transfer object     | `chat-completion.dto.ts`           |
| `.service.ts`    | Application    | Application service      | `cost-calculator.service.ts`       |
| `.repository.ts` | Infrastructure | Database access          | `api-key.repository.ts`            |
| `.adapter.ts`    | Infrastructure | External service adapter | `nine-router.adapter.ts`           |
| `.controller.ts` | Presentation   | Request handler          | `chat-completions.controller.ts`   |
| `.route.ts`      | Presentation   | Route definition         | `chat-completions.route.ts`        |
| `.middleware.ts` | Presentation   | HTTP middleware          | `auth.middleware.ts`               |
| `.validator.ts`  | Presentation   | Zod schemas              | `chat-completion.validator.ts`     |
| `.type.ts`       | Shared         | Type definitions         | `api.type.ts`                      |
| `.constant.ts`   | Shared         | Constants                | `error-codes.constant.ts`          |
| `.util.ts`       | Shared         | Utility functions        | `hash.util.ts`                     |
| `.test.ts`       | Tests          | Unit/integration test    | `chat-completion.use-case.test.ts` |
| `.mock.ts`       | Tests          | Test mocks/fixtures      | `api-key.mock.ts`                  |
| `.config.ts`     | Config         | Configuration            | `drizzle.config.ts`                |

### 3.3 Index Files

- Use `index.ts` barrel exports **only at package boundaries** (e.g., `packages/shared/src/index.ts`)
- **Do not** use `index.ts` within feature directories — import files directly
- This prevents circular dependency issues and improves tree-shaking

```typescript
// ✅ GOOD — packages/shared/src/index.ts (package boundary)
export { AppError, ValidationError, NotFoundError } from './errors/app-error';
export { hashApiKey } from './utils/hash.util';
export type { User, ApiKey, Model } from './types/entities.type';

// ❌ BAD — apps/gateway/src/application/use-cases/index.ts (feature directory)
export { ChatCompletionUseCase } from './chat-completion.use-case';
export { ListModelsUseCase } from './list-models.use-case';
// Instead, import directly from the file
```

---

## 4. API Conventions

### 4.1 RESTful Design

| Principle            | Rule                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| **Resources**        | Plural nouns, kebab-case: `/api/v1/api-keys`, `/api/v1/usage-records` |
| **HTTP Methods**     | GET (read), POST (create), PATCH (partial update), DELETE (remove)    |
| **Versioning**       | URL path prefix: `/api/v1/`, `/v1/` (gateway)                         |
| **No verbs in URLs** | ❌ `/api/v1/createUser` → ✅ `POST /api/v1/users`                     |
| **Nesting**          | Max 2 levels: `/api/v1/organizations/{id}/members`                    |

### 4.2 URL Structure

```
Gateway API (OpenAI-compatible):
  POST   /v1/chat/completions        # Chat completion
  GET    /v1/models                   # List models
  GET    /v1/models/{model_id}        # Get model details

Dashboard API:
  GET    /api/v1/me                   # Current user profile
  PATCH  /api/v1/me                   # Update profile

  GET    /api/v1/organizations        # List user's orgs
  POST   /api/v1/organizations        # Create org
  PATCH  /api/v1/organizations/{id}   # Update org
  GET    /api/v1/organizations/{id}/members    # List members
  POST   /api/v1/organizations/{id}/members    # Invite member
  DELETE /api/v1/organizations/{id}/members/{userId}  # Remove member

  GET    /api/v1/api-keys             # List API keys
  POST   /api/v1/api-keys             # Create API key
  PATCH  /api/v1/api-keys/{id}        # Update key settings
  DELETE /api/v1/api-keys/{id}        # Revoke key

  GET    /api/v1/usage                # Usage analytics
  GET    /api/v1/usage/summary        # Usage summary stats

  GET    /api/v1/models               # Model catalog

Admin API:
  GET    /api/v1/admin/providers      # List providers
  POST   /api/v1/admin/providers      # Add provider
  PATCH  /api/v1/admin/providers/{id} # Update provider
  GET    /api/v1/admin/users          # List all users
  GET    /api/v1/admin/health         # System health

Health:
  GET    /health/live                 # Liveness probe
  GET    /health/ready                # Readiness probe
```

### 4.3 Response Format

#### Success Response

```typescript
// Single resource
{
  "success": true,
  "data": {
    "id": "01912e4a-5b6c-7d8e-9f0a-1b2c3d4e5f6a",
    "name": "Production Key",
    "keyPrefix": "bak_live_a1b",
    "isActive": true,
    "createdAt": "2026-08-06T12:00:00Z"
  }
}

// Collection with pagination
{
  "success": true,
  "data": [
    { "id": "...", "name": "Key 1", ... },
    { "id": "...", "name": "Key 2", ... }
  ],
  "meta": {
    "pagination": {
      "cursor": "eyJpZCI6IjAxOTEyZTRhLTViNmMifQ==",
      "limit": 50,
      "hasMore": true
    }
  }
}
```

#### Error Response

```typescript
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please retry after 30 seconds.",
    "details": {
      "limit": 100,
      "remaining": 0,
      "resetAt": "2026-08-06T12:01:00Z"
    }
  }
}
```

### 4.4 HTTP Status Codes

| Code  | Meaning               | When to Use                                     |
| ----- | --------------------- | ----------------------------------------------- |
| `200` | OK                    | Successful GET, PATCH                           |
| `201` | Created               | Successful POST (resource created)              |
| `204` | No Content            | Successful DELETE                               |
| `400` | Bad Request           | Malformed request syntax                        |
| `401` | Unauthorized          | Missing or invalid authentication               |
| `403` | Forbidden             | Valid auth but insufficient permissions         |
| `404` | Not Found             | Resource does not exist                         |
| `409` | Conflict              | Resource already exists (e.g., duplicate email) |
| `422` | Unprocessable Entity  | Valid syntax but semantic validation failed     |
| `429` | Too Many Requests     | Rate limit exceeded                             |
| `500` | Internal Server Error | Unhandled server error                          |
| `502` | Bad Gateway           | AI provider returned an error                   |
| `503` | Service Unavailable   | Service temporarily unavailable                 |

### 4.5 Pagination

Use **cursor-based** pagination for stable, performant paging:

```
GET /api/v1/api-keys?cursor=eyJpZCI6IjAxOTEyZTRhIn0&limit=50
```

| Parameter | Type    | Default | Max | Description                          |
| --------- | ------- | ------- | --- | ------------------------------------ |
| `cursor`  | string  | —       | —   | Opaque cursor from previous response |
| `limit`   | integer | 20      | 100 | Number of items to return            |

### 4.6 Filtering & Sorting

```
GET /api/v1/usage?model=llama-3.1-70b&status=active&sort=-created_at
```

| Parameter  | Format                                | Example                            |
| ---------- | ------------------------------------- | ---------------------------------- |
| Filtering  | `?{field}={value}`                    | `?status=active&model=gpt-4`       |
| Sorting    | `?sort={field}` (prefix `-` for DESC) | `?sort=-created_at` (newest first) |
| Date range | `?from={ISO}&to={ISO}`                | `?from=2026-08-01&to=2026-08-31`   |

### 4.7 Standard Headers

#### Request Headers

| Header          | Required         | Description                                           |
| --------------- | ---------------- | ----------------------------------------------------- |
| `Authorization` | Yes (gateway)    | `Bearer bak_live_xxx`                                 |
| `Content-Type`  | Yes (POST/PATCH) | `application/json`                                    |
| `X-Request-Id`  | No               | Client-provided correlation ID (forwarded if present) |

#### Response Headers

| Header                  | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `X-Request-Id`          | Request correlation ID (generated or forwarded) |
| `X-RateLimit-Limit`     | Maximum requests allowed in window              |
| `X-RateLimit-Remaining` | Requests remaining in current window            |
| `X-RateLimit-Reset`     | Unix timestamp when window resets               |
| `Retry-After`           | Seconds to wait (on 429 responses)              |

### 4.8 Example: Chat Completion

**Request:**

```http
POST /v1/chat/completions HTTP/1.1
Host: api.baseapikey.com
Authorization: Bearer bak_live_a1b2c3d4e5f6g7h8
Content-Type: application/json

{
  "model": "llama-3.1-70b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 256,
  "stream": false
}
```

**Response (200 OK):**

```json
{
  "id": "chatcmpl-01912e4a5b6c7d8e",
  "object": "chat.completion",
  "created": 1722931200,
  "model": "llama-3.1-70b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 9,
    "total_tokens": 29
  }
}
```

---

## 5. Error Handling

### 5.1 Error Class Hierarchy

```typescript
// Base error class — all custom errors extend this
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON(): ErrorResponse {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// Specific error classes
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Invalid or missing authentication') {
    super('AUTHENTICATION_ERROR', message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super('AUTHORIZATION_ERROR', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super('NOT_FOUND', `${resource}${id ? ` with ID ${id}` : ''} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', 429, { retryAfter });
  }
}

export class ProviderError extends AppError {
  constructor(message: string, providerCode?: string) {
    super('PROVIDER_ERROR', message, 502, providerCode ? { providerCode } : undefined);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super('INTERNAL_ERROR', message, 500);
  }
}
```

### 5.2 Global Error Handler

```typescript
// presentation/middleware/error-handler.middleware.ts
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Known application errors
  if (error instanceof AppError) {
    request.log.warn({ err: error, requestId: request.id }, error.message);
    reply.code(error.statusCode).send(error.toJSON());
    return;
  }

  // Fastify validation errors (from Zod/JSON Schema)
  if ('validation' in error) {
    reply.code(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.validation,
      },
    });
    return;
  }

  // Unknown / unexpected errors — log full details, return generic message
  request.log.error({ err: error, requestId: request.id }, 'Unhandled error');
  reply.code(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
```

### 5.3 Error Handling Rules

| Rule                             | Details                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| **Never expose internals**       | Never return stack traces, SQL errors, or file paths to clients                 |
| **Always log full error**        | Log the complete error internally (with stack trace) for debugging              |
| **Result for expected failures** | Use `Result<T, E>` for business logic failures (validation, auth, limits)       |
| **Exceptions for unexpected**    | Throw exceptions for infrastructure failures (DB down, network errors)          |
| **Map provider errors**          | Map provider-specific errors to gateway error codes                             |
| **Include request ID**           | Every error response includes the `X-Request-Id` header for support correlation |

---

## 6. Logging

### 6.1 Logger Setup

All applications use the shared `@baseapikey/logger` package wrapping Pino:

```typescript
import { createLogger } from '@baseapikey/logger';

const logger = createLogger({
  service: 'gateway',
  level: process.env.LOG_LEVEL || 'info',
});
```

### 6.2 Log Format

All logs are structured JSON:

```json
{
  "level": 30,
  "time": 1722931200000,
  "pid": 12345,
  "hostname": "gateway-pod-abc",
  "service": "gateway",
  "requestId": "01912e4a-5b6c-7d8e-9f0a-1b2c3d4e5f6a",
  "msg": "Request completed",
  "method": "POST",
  "path": "/v1/chat/completions",
  "statusCode": 200,
  "latencyMs": 1250,
  "userId": "01912e4a-...",
  "organizationId": "01912e4a-..."
}
```

### 6.3 Log Levels

| Level   | Numeric | When to Use                            | Example                                                   |
| ------- | ------- | -------------------------------------- | --------------------------------------------------------- |
| `fatal` | 60      | Application crash, unrecoverable state | `Database connection pool exhausted`                      |
| `error` | 50      | Operation failed, requires attention   | `Provider returned 500`, `Webhook delivery failed`        |
| `warn`  | 40      | Unexpected but recoverable situation   | `Rate limit approaching threshold`, `Deprecated API used` |
| `info`  | 30      | Normal operational events              | `Server started`, `Request completed`, `Key created`      |
| `debug` | 20      | Detailed diagnostic information        | `Cache hit/miss`, `Query executed in 12ms`                |
| `trace` | 10      | Very fine-grained diagnostic events    | `Entering function X`, `Raw provider response`            |

### 6.4 Environment Configuration

| Environment | Default Level | Pretty Print        |
| ----------- | ------------- | ------------------- |
| Development | `debug`       | Yes (`pino-pretty`) |
| Staging     | `info`        | No (JSON)           |
| Production  | `info`        | No (JSON)           |

### 6.5 PII Redaction

The logger **must** redact sensitive data. Configure Pino redaction paths:

```typescript
const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.api_key',
      'req.body.messages[*].content', // Redact prompt content in production
      'res.body',
    ],
    censor: '[REDACTED]',
  },
});
```

| Data Type                   | Rule                                                        |
| --------------------------- | ----------------------------------------------------------- |
| **Full API keys**           | Never log — only log prefix (first 12 chars)                |
| **Passwords**               | Never log                                                   |
| **Auth headers**            | Always redact                                               |
| **Request/Response bodies** | Redact in production, optional in development               |
| **Email addresses**         | Log only in audit contexts                                  |
| **IP addresses**            | Allowed in request logs (needed for rate limiting/security) |

### 6.6 Contextual Logging

Enrich logs with request context:

```typescript
// ✅ GOOD — structured context
logger.info(
  {
    requestId: request.id,
    apiKeyPrefix: 'bak_live_a1b',
    organizationId: org.id,
    model: 'llama-3.1-70b',
    inputTokens: 150,
    outputTokens: 45,
    costCents: 0.0234,
    latencyMs: 1250,
    provider: '9router',
  },
  'Chat completion successful',
);

// ❌ BAD — unstructured string concatenation
logger.info(`Request ${requestId} completed in ${latencyMs}ms for key ${apiKey}`);
```

---

## 7. Security Rules

### 7.1 Input Validation

**Every** API endpoint must validate input using Zod schemas:

```typescript
// ✅ GOOD — strict input validation with bounds
const ChatCompletionSchema = z.object({
  model: z.string().min(1).max(255),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(100_000),
      }),
    )
    .min(1)
    .max(100),
  temperature: z.number().min(0).max(2).optional().default(1),
  max_tokens: z.number().int().min(1).max(128_000).optional(),
  stream: z.boolean().optional().default(false),
});

// ❌ BAD — no validation
app.post('/v1/chat/completions', async (req, res) => {
  const { model, messages } = req.body; // Unvalidated!
});
```

### 7.2 API Key Security

| Rule             | Implementation                                          |
| ---------------- | ------------------------------------------------------- |
| **Generation**   | `crypto.randomBytes(32)` — 256 bits of entropy          |
| **Hashing**      | SHA-256 (`crypto.createHash('sha256')`)                 |
| **Storage**      | Only store hash + prefix (12 chars) in database         |
| **Comparison**   | `crypto.timingSafeEqual()` for constant-time comparison |
| **Display**      | Full key shown **once** at creation — never retrievable |
| **Logging**      | Never log full key — only prefix                        |
| **Transmission** | HTTPS only (enforced by infrastructure)                 |
| **Revocation**   | Immediate soft-delete — rejected on next request        |

### 7.3 HTTP Security Headers

Configure via Helmet.js:

```typescript
app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
});
```

### 7.4 Security Checklist

| Category          | Rule                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| **SQL Injection** | Use Drizzle ORM (parameterized queries) — no raw SQL unless reviewed |
| **XSS**           | Content-Security-Policy headers, output encoding                     |
| **CSRF**          | SameSite cookies + CSRF tokens on dashboard                          |
| **CORS**          | Whitelist origins for dashboard; permissive for gateway API          |
| **Request Size**  | Body limit: 1MB default (Fastify `bodyLimit`)                        |
| **Rate Limiting** | Redis sliding window on all public endpoints                         |
| **Dependencies**  | `npm audit` + Dependabot in CI — fail on critical CVEs               |
| **Secrets**       | Environment variables only — never in code, never in Git             |
| **URLs**          | Never put sensitive data in query strings (API keys, tokens)         |
| **Encryption**    | TLS 1.3 in transit, AES-256 for provider API keys at rest            |

---

## 8. Clean Architecture Rules

### 8.1 Layer Dependency Rules

```mermaid
flowchart TB
    subgraph "Layer 0 — Domain"
        D[Entities<br/>Value Objects<br/>Domain Errors]
    end

    subgraph "Layer 1 — Application"
        A[Use Cases<br/>Ports / Interfaces<br/>DTOs<br/>Application Services]
    end

    subgraph "Layer 2 — Infrastructure"
        I[DB Repositories<br/>Provider Adapters<br/>Redis Cache<br/>Queue Workers]
    end

    subgraph "Layer 2 — Presentation"
        P[Routes<br/>Controllers<br/>Middleware<br/>Validators]
    end

    A -->|depends on| D
    I -->|depends on| A
    I -->|depends on| D
    P -->|depends on| A
    P -->|depends on| D

    style D fill:#4CAF50,color:#fff
    style A fill:#2196F3,color:#fff
    style I fill:#FF9800,color:#fff
    style P fill:#9C27B0,color:#fff
```

### 8.2 Core Rules

| Rule                                                 | Description                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Inner layers have zero knowledge of outer layers** | Domain never imports from application, infrastructure, or presentation                         |
| **Dependencies point inward**                        | Presentation → Application → Domain. Infrastructure → Application → Domain                     |
| **Ports define contracts**                           | Application defines `interface IApiKeyRepository` — infrastructure provides the implementation |
| **Domain is pure**                                   | No framework imports, no database queries, no HTTP concepts in domain layer                    |
| **Application orchestrates**                         | Use cases call ports (interfaces), not concrete implementations                                |
| **Framework stays at the edge**                      | Fastify, Next.js, Drizzle are only in infrastructure/presentation                              |

### 8.3 Dependency Inversion Example

```typescript
// ✅ GOOD — Application defines port, Infrastructure implements it

// application/ports/api-key-repository.port.ts (Application layer)
export interface IApiKeyRepository {
  findByHash(hash: string): Promise<ApiKeyEntity | null>;
  create(data: CreateApiKeyDto): Promise<ApiKeyEntity>;
  revoke(id: string): Promise<void>;
}

// infrastructure/database/api-key.repository.ts (Infrastructure layer)
import type { IApiKeyRepository } from '../../application/ports/api-key-repository.port';

export class DrizzleApiKeyRepository implements IApiKeyRepository {
  constructor(private readonly db: DrizzleClient) {}

  async findByHash(hash: string): Promise<ApiKeyEntity | null> {
    return this.db.query.apiKeys.findFirst({
      where: eq(apiKeys.keyHash, hash),
    });
  }
  // ... other methods
}

// application/use-cases/validate-api-key.use-case.ts (Application layer)
export class ValidateApiKeyUseCase {
  constructor(private readonly apiKeyRepo: IApiKeyRepository) {} // Port, not implementation!

  async execute(rawKey: string): Promise<Result<ApiKeyContext>> {
    const hash = hashApiKey(rawKey);
    const apiKey = await this.apiKeyRepo.findByHash(hash);
    // ... business logic
  }
}
```

### 8.4 What Goes Where

| Layer              | Contains                                                    | Does NOT Contain                                        |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------- |
| **Domain**         | Entities, Value Objects, Domain Errors, Business Rules      | Database queries, HTTP concepts, framework imports      |
| **Application**    | Use Cases, Ports (interfaces), DTOs, Application Services   | Database implementations, HTTP handlers, framework code |
| **Infrastructure** | Repository implementations, Provider adapters, Cache, Queue | Business rules, HTTP route definitions                  |
| **Presentation**   | Routes, Controllers, Middleware, Validators                 | Business logic, direct DB queries, provider calls       |

---

## 9. SOLID Principles

### 9.1 S — Single Responsibility Principle

> _A class/module should have only one reason to change._

**Application in this project:**

```typescript
// ✅ GOOD — each class has one responsibility
class ChatCompletionUseCase {
  // Only orchestrates chat completion flow
}

class CostCalculatorService {
  // Only calculates request cost from token counts + pricing
}

class RedisRateLimiter {
  // Only handles rate limiting logic
}

// ❌ BAD — god class doing everything
class ApiGateway {
  async handleChatCompletion(req: Request) {
    // Validates request
    // Checks rate limits
    // Authenticates user
    // Routes to provider
    // Calculates cost
    // Logs usage
    // Sends webhook
    // ... 500 lines of mixed concerns
  }
}
```

### 9.2 O — Open/Closed Principle

> _Open for extension, closed for modification._

**Application:** The provider system is open for extension (add new providers) without modifying existing code.

```typescript
// ✅ GOOD — add providers by creating new classes, not modifying existing ones
// Adding Anthropic support:
// 1. Create new file: anthropic.adapter.ts
// 2. Extend BaseProviderAdapter
// 3. Register in factory
// NO changes to gateway core, routing logic, or other adapters

class AnthropicAdapter extends BaseProviderAdapter {
  getName(): string {
    return 'anthropic';
  }
  async chatCompletion(request: UnifiedChatRequest): Promise<ChatResponse> {
    // Anthropic-specific implementation
  }
}

// Register — no modification to existing code
providerFactory.registerAdapter(new AnthropicAdapter(config));

// ❌ BAD — if/else chain requires modification for every new provider
function routeToProvider(provider: string, request: any) {
  if (provider === '9router') {
    /* ... */
  } else if (provider === 'openai') {
    /* ... */
  } else if (provider === 'anthropic') {
    /* ... */
  } // Must modify this function!
}
```

### 9.3 L — Liskov Substitution Principle

> _Subtypes must be substitutable for their base types._

**Application:** Any provider adapter can be used wherever `IProviderAdapter` is expected.

```typescript
// ✅ GOOD — all adapters are interchangeable
const adapter: IProviderAdapter = providerFactory.getAdapter(providerSlug);
// Works identically whether adapter is NineRouterAdapter, OpenAIAdapter, etc.
const response = await adapter.chatCompletion(unifiedRequest);

// The gateway doesn't know or care which concrete adapter it's using.
// All adapters honor the same contract: same input types, same output types,
// same error behavior.

// ❌ BAD — subtype violates base type contract
class BadAdapter extends BaseProviderAdapter {
  async chatCompletion(): Promise<ChatResponse> {
    // Returns a different format than the interface specifies
    // Or throws unexpected error types
    // Or has different timeout behavior
    throw new Error('Not implemented'); // Violates LSP!
  }
}
```

### 9.4 I — Interface Segregation Principle

> _No client should be forced to depend on interfaces it does not use._

**Application:** Separate read and write repository interfaces.

```typescript
// ✅ GOOD — segregated interfaces
interface IApiKeyReader {
  findByHash(hash: string): Promise<ApiKeyEntity | null>;
  findById(id: string): Promise<ApiKeyEntity | null>;
  findByOrganization(orgId: string): Promise<ApiKeyEntity[]>;
}

interface IApiKeyWriter {
  create(data: CreateApiKeyDto): Promise<ApiKeyEntity>;
  update(id: string, data: UpdateApiKeyDto): Promise<ApiKeyEntity>;
  revoke(id: string): Promise<void>;
}

// Auth middleware only needs to read — doesn't depend on write operations
class AuthMiddleware {
  constructor(private readonly apiKeyReader: IApiKeyReader) {}
}

// Key management use case needs both
class ManageApiKeysUseCase {
  constructor(
    private readonly reader: IApiKeyReader,
    private readonly writer: IApiKeyWriter,
  ) {}
}

// ❌ BAD — fat interface forces unnecessary dependencies
interface IApiKeyRepository {
  findByHash(hash: string): Promise<ApiKeyEntity | null>;
  findById(id: string): Promise<ApiKeyEntity | null>;
  findByOrganization(orgId: string): Promise<ApiKeyEntity[]>;
  create(data: CreateApiKeyDto): Promise<ApiKeyEntity>;
  update(id: string, data: UpdateApiKeyDto): Promise<ApiKeyEntity>;
  revoke(id: string): Promise<void>;
  // Auth middleware is forced to depend on create/update/revoke even though it
  // never uses them
}
```

### 9.5 D — Dependency Inversion Principle

> _Depend on abstractions, not concretions._

**Application:** Use cases depend on port interfaces, not database or HTTP implementations.

```typescript
// ✅ GOOD — use case depends on abstraction (port)
class ChatCompletionUseCase {
  constructor(
    private readonly providerAdapter: IProviderAdapter, // Port
    private readonly modelRepo: IModelRepository, // Port
    private readonly costCalculator: ICostCalculator, // Port
    private readonly usageTracker: IUsageTracker, // Port
  ) {}

  async execute(request: ChatCompletionDto): Promise<Result<ChatResponse>> {
    const model = await this.modelRepo.findByModelId(request.model);
    const response = await this.providerAdapter.chatCompletion(request);
    const cost = this.costCalculator.calculate(response.usage, model.pricing);
    await this.usageTracker.track({ ...response.usage, cost });
    return { success: true, data: response };
  }
}

// The use case has NO idea whether:
// - providerAdapter talks to 9Router or OpenAI
// - modelRepo uses PostgreSQL or MongoDB
// - costCalculator uses simple math or a complex billing engine
// - usageTracker writes to Redis, Kafka, or a database

// ❌ BAD — use case depends on concrete implementations
class ChatCompletionUseCase {
  constructor(
    private readonly db: DrizzleClient, // Concrete DB!
    private readonly redis: RedisClient, // Concrete cache!
    private readonly nineRouterClient: NineRouterSDK, // Concrete provider!
  ) {}
  // Now this class is tightly coupled to specific technologies
}
```

---

## Appendix: Quick Reference Card

| Category                | Convention                                                     |
| ----------------------- | -------------------------------------------------------------- |
| **Folders**             | lowercase, kebab-case                                          |
| **Files**               | kebab-case with role suffix (`.controller.ts`, `.use-case.ts`) |
| **Types/Interfaces**    | PascalCase, `I` prefix for ports                               |
| **Variables/Functions** | camelCase                                                      |
| **Constants**           | UPPER_SNAKE_CASE                                               |
| **API URLs**            | `/api/v1/{resource}` — kebab-case, plural                      |
| **DB Tables**           | snake_case, plural                                             |
| **DB Columns**          | snake_case                                                     |
| **Primary Keys**        | `id` (UUID v7)                                                 |
| **Foreign Keys**        | `{table_singular}_id`                                          |
| **Booleans**            | `is_` or `supports_` prefix                                    |
| **Timestamps**          | `_at` suffix                                                   |
| **Error Handling**      | Result pattern for expected, exceptions for unexpected         |
| **Logging**             | Structured JSON (Pino), redact PII                             |
| **Imports**             | Direct file imports (no barrel exports within features)        |
