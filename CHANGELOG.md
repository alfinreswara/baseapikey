# Changelog

All notable changes to the BaseAPIKey project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Dashboard Session & Release-Gate Hardening**
  - Moved rotating refresh tokens out of browser storage into a same-origin Dashboard session bridge
    using production `__Host-` cookies with `HttpOnly`, `Secure`, and `SameSite=Strict` controls.
  - Added origin validation, request-size and upstream time limits, no-store responses, legacy token
    cleanup, automatic access-token recovery, and secure local logout behavior.
  - Coalesced concurrent refreshes within a tab, coordinated refreshes across tabs, restored account
    profiles after cold reloads, narrowed Dashboard CSP connections, enabled production HSTS, and
    enforced production HTTPS/runtime environment validation at process startup.
  - Added Chromium E2E coverage for login, startup, expired and concurrent-token refresh, profile
    recovery, API-key creation, primary console views, and logout; fixed dialog cancellation
    uncovered by the browser test.
  - Added CI validation that applies all Prisma migrations to an empty PostgreSQL 16 database and
    confirms migration status.
  - Added CodeQL analysis, repository secret detection, Docker/Kubernetes misconfiguration checks,
    high/critical image vulnerability gates, and retained CycloneDX image SBOMs.
  - Added a manually approved, semantic-versioned multi-architecture GHCR release workflow with
    BuildKit provenance/SBOM attestations, post-build vulnerability scans, and release SBOM
    artifacts.
  - Added weekly Dependabot updates for npm, GitHub Actions, and Docker dependencies, and hardened
    the database backup container with a read-only root filesystem.
  - Removed test-only mock repositories from the production quota and usage module exports.

- **Production completion pass**
  - Added an operations Dashboard for authentication, organizations, keys, usage, models, team, billing, and admin workflows.
  - Added organization-scoped API keys/analytics, model-priced metering, a Redis usage queue, daily aggregates, credit charging, spending controls, and alerts.
  - Added model-to-provider routing, provider hot reload, periodic health monitoring, protected Prometheus metrics, invitation emails, and platform admin endpoints.
  - Added hardened Dashboard packaging, Kubernetes deployment resources, backups, monitoring, CI container builds, a release checklist, and a production runbook.

- **Backend Product Completion — Items 4–8**
  - Added organizations, active organization preferences, owner/admin/member RBAC, member
    management, personal-organization provisioning/backfill, billing accounts, and organization
    audit trails.
  - Added credit balances, invoice and transaction history, external checkout creation, and
    HMAC-authenticated idempotent purchase webhooks.
  - Added admin-only provider/model management and audit-log queries with AES-256-GCM credential
    encryption, credential redaction, and model-cache invalidation.
  - Added database-backed OpenAI-compatible provider loading plus retry with exponential backoff,
    circuit breakers, capability-aware priority fallback, and cancellation handling.
  - Added `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech`, and multipart
    `/v1/audio/transcriptions` with per-feature permissions, quota enforcement, and usage capture.
  - Added production environment validation, migration coverage, Compose wiring, and focused tests
    for organization safety, billing signatures, admin encryption, provider resilience, and the new
    inference endpoints.

- **Account & Credential Management API**
  - Added JWT/RBAC-protected `GET /api/v1/me` and `PATCH /api/v1/me` endpoints with strict Zod
    validation, audit records, no client-selectable user scope, and zero password-hash exposure.
  - Added current-password-authenticated password changes plus public password-reset request and
    confirmation flows; successful credential changes revoke every active user session.
  - Added email-verification request and confirmation endpoints with purpose-bound, expiring,
    cryptographically random tokens stored only as SHA-256 digests in Redis and atomically consumed.
  - Added enumeration-safe reset responses, Redis-backed request throttling, authenticated HTTPS
    email-webhook delivery, and production environment validation for webhook credentials.
  - Added HTTP/service coverage for authentication, RBAC, validation, auditing, one-time token replay,
    notification failure behavior, session revocation, and Redis token secrecy.

- **Dashboard Usage Analytics API**
  - Added JWT- and RBAC-protected `GET /api/v1/usage` daily time-series analytics with UTC date
    bucketing and grouping by model, API key, or provider.
  - Added `GET /api/v1/usage/summary` totals and per-model/provider breakdowns for requests, errors,
    tokens, cost, and average latency.
  - Added `GET /api/v1/usage/history` with cursor pagination and privacy-safe event responses that
    exclude client IP and user-agent data.
  - Added strict user isolation derived from JWT claims, query allowlisting, 30-day defaults,
    366-day maximum ranges, and configurable model/API-key/provider/status filters.
  - Added indexed Prisma aggregation and parameterized PostgreSQL time-series queries plus HTTP,
    validation, authentication, authorization, pagination, and isolation coverage.

- **OpenAI-Compatible Model Catalog**
  - Added public `GET /v1/models` backed by active PostgreSQL model and provider records.
  - Added OpenAI-compatible model fields plus display name, context limits, USD pricing, capabilities,
    and provider details.
  - Added a validated Redis `model:catalog` cache with a configurable 300-second default TTL,
    cache invalidation, per-process refresh coalescing, and fail-open database fallback.
  - Added model lookup and provider resolution methods for subsequent gateway routing work.
  - Added service, cache, and HTTP integration coverage, including corrupt and unavailable Redis
    behavior.

- **Backend Deployment Candidate Hardening**
  - Upgraded the Gateway to Fastify 5 and the matching supported CORS and Helmet plugin lines.
  - Added Redis-backed sliding-window login throttling for normalized email and source IP keys.
  - Replaced mocked readiness with injectable PostgreSQL and Redis probes and bounded timeouts.
  - Added configurable CORS allowlisting, CSP, HSTS, anti-framing, and content-type security headers.
  - Added explicit trusted-proxy configuration so source-IP throttling remains correct behind ingress.
  - Connected Redis startup, health, rate limiting, and graceful shutdown to the production runtime.
  - Made workspace package exports resolve compiled output and verified a standalone production artifact.
  - Added a multi-stage non-root Gateway Dockerfile and production Compose stack with a one-shot Prisma migration service.
  - Documented staging approval checks and remaining dashboard-facing backend APIs.
  - Pinned the patched `fast-uri` transitive dependency after a production audit reported four high-severity advisories; the follow-up audit is clean.

- **Production Hardening — Runtime Safety & CI Enforcement**
  - Reject insecure, reused, or placeholder JWT secrets when the Gateway starts in production.
  - Enforce the configured maximum request body size and return a structured `413 PAYLOAD_TOO_LARGE` response.
  - Prevent unexpected server errors from leaking internal exception messages while retaining structured server-side logs.
  - Add graceful `SIGTERM` and `SIGINT` shutdown handling for Fastify and Prisma with a bounded timeout.
  - Add runtime hardening coverage for error sanitization and payload-size enforcement.
  - Require the full automated test suite to pass before the CI build job runs.

- **Gateway Runtime Integration Hardening**
  - Wired `QuotaService` into the production `POST /v1/chat/completions` pre-handler so request-per-minute and request-per-day limits are enforced outside test fixtures.
  - Wired asynchronous usage recording into the main Fastify application using `PrismaUsageRepository` and shared runtime repositories.
  - Captured non-streaming and SSE token usage metadata and applied completed token/cost totals to API key quota counters after responses.
  - Added dependency injection hooks for quota and usage services so runtime wiring remains integration-testable without PostgreSQL.
  - Replaced deprecated Fastify `request.routerPath` usage with `request.routeOptions.url`.
  - Added the missing Prisma migration for `sessions` and `api_key_quotas`, including indexes, uniqueness constraints, cascading foreign keys, and the Prisma migration lock file.
  - Extended chat integration tests to verify runtime quota rejection, usage records, and token quota accounting for both JSON and SSE responses.

- **Phase 5 Task 005 (P05-T05): Streaming (SSE)**
  - Added production-ready Server-Sent Events (SSE) streaming support to `POST /v1/chat/completions` when `stream: true`.
  - Updated `validateChatCompletionRequest()` allowing `stream: true` (or boolean) while preserving non-streaming `stream: false` behavior.
  - Implemented `ChatCompletionService.createStreamCompletion()` consuming provider stream and yielding OpenAI-compatible `ChatCompletionChunkDTO` chunks.
  - Extended `createChatCompletionController()` to stream progressive SSE payloads (`text/event-stream`, `no-cache`, `keep-alive`) with termination signal `data: [DONE]` sent exactly once.
  - Added client disconnect cancellation forwarding `AbortSignal` to upstream provider requests.
  - Handled stream error boundary (HTTP status error code before headers sent; SSE error chunk format if error occurs mid-stream).
  - Built unit & integration test cases in `apps/gateway/src/modules/chat/chat.test.ts` covering streaming headers, chunk sequence, `[DONE]` termination, error handling, cancellation, and API key security.

- **Phase 5 Task 004 (P05-T04): Chat Completions API**
  - Implemented non-streaming OpenAI-compatible Chat Completions endpoint `POST /v1/chat/completions` in `apps/gateway/src/modules/chat/`.
  - Enforced API Key authentication via `authenticateApiKey` middleware and `requireApiKeyPermission('chat:completions')` guard.
  - Implemented request validation in `validateChatCompletionRequest()` for required `model`, non-empty `messages`, valid roles (`system`, `user`, `assistant`, `tool`, `developer`), and parameter bounds (`temperature`, `top_p`, `max_tokens`). Rejects `stream: true` for this non-streaming task.
  - Created `ChatCompletionService` executing requests through `ProviderRegistry` to 9Router adapter and mapping responses into OpenAI-compatible format with usage token counts (`prompt_tokens`, `completion_tokens`, `total_tokens`).
  - Built unit & integration test suite in `apps/gateway/src/modules/chat/chat.test.ts` covering authentication, permission enforcement, validation, successful completion mapping, provider error handling (404, 429, 504, 502, 500), and API key security.

- **Phase 5 Task 003 (P05-T03): 9Router Provider Adapter**
  - Implemented `NineRouterProvider` adapter in `apps/gateway/src/modules/providers/9router/` under provider ID `"9router"` implementing `IProviderAdapter`.
  - Created bidirectional wire data mappers for non-streaming chat completions, SSE streaming chunks (`data: ...`, `data: [DONE]`), and model catalog retrieval (`listModels`).
  - Implemented `mapNineRouterError` converting 9Router HTTP error responses, network failures, timeouts, and cancellations into normalized `ProviderError` instances while redacting API keys and Authorization headers.
  - Implemented request cancellation support via `AbortSignal` and timeout controller.
  - Added `registerNineRouter()` module bootstrap function for clean `ProviderRegistry` integration.
  - Built unit test suite in `apps/gateway/src/modules/providers/9router.test.ts` using mocked HTTP fetch responses covering request/response transformation, SSE streaming, model listing, health checks, error mapping, cancellation, secret redaction, and registry integration.

- **Phase 5 Task 002 (P05-T02): Provider Registry**
  - Created `ProviderRegistry`, `ProviderRegistration`, `ProviderLookupResult`, and `ProviderRegistryError` in `@baseapikey/shared`.
  - Implemented provider registration, unregistration, lookup, existence check, listing, and capability filtering (`chat`, `streaming`, `models`, `tools`, `vision`).
  - Added strict contract validation on registration rejecting non-conforming objects (HTTP 400 `INVALID_PROVIDER_CONTRACT`) and duplicate provider IDs (HTTP 409 `DUPLICATE_PROVIDER_REGISTRATION`).
  - Added normalized lookup error handling throwing `ProviderRegistryError` (HTTP 404 `PROVIDER_NOT_FOUND`) for unknown provider IDs without silent fallbacks.
  - Built unit test suite in `apps/gateway/src/modules/providers/provider-registry.test.ts` verifying registration, lookup, capability search, error handling, duplicate prevention, and unregistration.

- **Phase 5 Task 001 (P05-T01): Provider Interface & Abstraction**
  - Created provider contract `IProviderAdapter` in `@baseapikey/shared` with core methods: `getName()`, `getCapabilities()`, `chat()`, `streamChat()`, `chatCompletion()`, `listModels()`, and `healthCheck()`.
  - Defined normalized OpenAI-compatible internal data types: `ProviderRequest` (`UnifiedChatRequest`), `ProviderResponse` (`ChatResponse`), `ProviderStreamChunk` (`StreamChunk`), `ProviderModel`, `ProviderCapabilities`, `ProviderHealthStatus`, and `ProviderRequestOptions` (with `AbortSignal` cancellation support).
  - Implemented normalized `ProviderError` class extending `AppError` supporting error categories (`AUTHENTICATION_ERROR`, `INVALID_REQUEST`, `MODEL_NOT_FOUND`, `RATE_LIMIT`, `TIMEOUT`, `PROVIDER_UNAVAILABLE`, `SERVER_ERROR`, `UNKNOWN_ERROR`), HTTP status normalization via `fromHttpStatus()`, and retryability evaluation via `isRetryableCategory()`.
  - Built comprehensive unit test suite in `apps/gateway/src/modules/providers/provider.test.ts` verifying request/response representation, streaming async iterable, model listing, health checks, capabilities, error normalization, and request cancellation.

- **Phase 4 Task 010 (P04-T10): API Key Security Hardening**
  - Conducted a comprehensive security review and hardening audit of the API Key Management ecosystem across Generation, Storage, Authentication, Authorization, Rotation, Revocation, Usage Tracking, Quotas & Limits, Audit Logging, and Correlation Headers.
  - Added `findByPrefix` to `IApiKeyRepository`, `PrismaApiKeyRepository`, and `MockApiKeyRepository` to enable explicit evaluation of `ApiKeyRevokedError` and `ApiKeyExpiredError` (HTTP 401) during authentication.
  - Enforced `Math.max(0, ...)` bounds across quota counter updates to prevent negative values.
  - Published comprehensive security review report in `docs/API_KEY_SECURITY_REVIEW.md`.

- **Phase 4 Task 009 (P04-T09): API Key Integration Testing**
  - Created test container, fixtures, and factories in `apps/gateway/src/modules/api-keys/testing/api-key-test-fixtures.ts`.
  - Built comprehensive master integration test suite in `apps/gateway/src/modules/api-keys/api-key-lifecycle-integration.test.ts` testing the complete API Key lifecycle across Generation, Authentication, Management, Permissions, Rotation, Revocation, Usage Tracking, Quotas & Limits, and Audit Logging.
  - Verified 100% of end-to-end integration test cases including edge cases (expired keys, revoked keys, suspended users, missing headers, invalid Bearer format, invalid permission strings, cross-user isolation HTTP 403 Forbidden, rate limit HTTP 429 Too Many Requests, and latency benchmarks).

- **Phase 4 Task 008 (P04-T08): API Key Quotas & Limits**
  - Added `ApiKeyQuota` model to `packages/database/prisma/schema.prisma` with fields for per-minute requests, daily requests, daily tokens, monthly budget USD, current counter values, and reset timestamps.
  - Implemented `QuotaService` and `PrismaQuotaRepository` in `apps/gateway/src/modules/quota/` managing limit checks, counter increments, and timestamp reset windows.
  - Created Fastify `requireQuota` middleware rejecting requests exceeding limits with `HTTP 429 Too Many Requests` (`QuotaExceededError`, `DailyLimitExceededError`, `TokenQuotaExceededError`, `MonthlyBudgetExceededError`).
  - Added `QuotaValidator` enforcing positive numeric values and rejecting zero or negative configuration limits with `HTTP 400 Bad Request` (`InvalidQuotaConfigError`).
  - Added `MockQuotaRepository` and built comprehensive unit & integration test suite in `apps/gateway/src/modules/quota/quota.test.ts` verifying request limit enforcement, daily limit enforcement, token quota enforcement, monthly budget enforcement, counter updates, reset logic, and validation rules.

- **Phase 4 Task 007 (P04-T07): API Key Usage Tracking**
  - Created dedicated Usage module under `apps/gateway/src/modules/usage/`.
  - Implemented `UsageTrackingService` and `PrismaUsageRepository` to record request metrics (`userId`, `apiKeyId`, `requestId`, `endpoint`, `method`, `provider`, `model`, `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCost`, `latencyMs`, `statusCode`, `clientIp`, `userAgent`) and update `ApiKey.lastUsedAt`.
  - Implemented `AsyncUsageRecorder` delivering non-blocking background usage recordings via `setImmediate` and emitting `UsageRecordedEvent` (`usage.recorded`).
  - Added Fastify `registerUsageTrackingHook` (`onRequest` / `onResponse`) middleware measuring request latency and capturing request/response metadata.
  - Added `MockUsageRepository` and comprehensive unit & integration test suite in `apps/gateway/src/modules/usage/usage-tracking.test.ts` verifying successful requests, failed requests (e.g. 403 Forbidden), latency calculation, token metrics, and event notifications.

- **Phase 4 Task 006 (P04-T06): API Key Revocation**
  - Implemented secure API Key revocation endpoint `POST /v1/api-keys/:id/revoke` in `apps/gateway/src/modules/api-keys/api-keys.routes.ts`.
  - Added `ApiKeyRevocationService` in `apps/gateway/src/modules/api-keys/services/api-key-revocation.service.ts` for soft-revoking API keys: updating status to `REVOKED`, setting `deletedAt` timestamp, and preserving key database records, usage history, and audit logs.
  - Updated `authenticateApiKey` middleware in `apps/gateway/src/modules/api-keys/middleware/api-key-auth.middleware.ts` to check candidate key status and immediately reject revoked keys with `401 Unauthorized` (`ApiKeyRevokedError`).
  - Added ownership verification (HTTP 403 Forbidden) and rejected re-revoking already revoked keys (HTTP 400 Bad Request `ApiKeyAlreadyRevokedError`).
  - Recorded revocation event in `AuditLog` (`action: 'API_KEY_REVOKE'`).
  - Built comprehensive unit & integration test suite in `apps/gateway/src/modules/api-keys/api-key-revocation.test.ts` verifying revocation, authentication blockage, rejection of key rotation/updates on revoked keys, cross-user isolation, and audit log generation.

- **Phase 4 Task 005 (P04-T05): API Key Rotation**
  - Implemented secure API Key rotation endpoint `POST /v1/api-keys/:id/rotate` in `apps/gateway/src/modules/api-keys/api-keys.routes.ts`.
  - Added `ApiKeyRotationService` in `apps/gateway/src/modules/api-keys/services/api-key-rotation.service.ts` handling secure key rotation: generating new cryptographically random `sk_live_...` API key, hashing with Argon2id, replacing `keyHash` & `keyPrefix` in database while preserving key `id`, `userId`, `name`, `permissions`, and `createdAt`.
  - Implemented `RotateApiKeyResponseDto` returning the new plaintext API key ONLY ONCE.
  - Added `rotateKey` repository method to `IApiKeyRepository`, `PrismaApiKeyRepository`, and `MockApiKeyRepository`.
  - Added strict rotation validation: verifying JWT user authentication, ownership enforcement (403 Forbidden), rejecting rotation on revoked keys (400 Bad Request), and rejecting rotation on expired keys (401 Unauthorized).
  - Implemented audit logging for rotation events (`action: 'API_KEY_ROTATE'`) in `AuditLog`.
  - Built comprehensive unit & integration test suite in `apps/gateway/src/modules/api-keys/api-key-rotation.test.ts` verifying key rotation, immediate invalidation of the old API key, authentication of the new API key, cross-user rejection, and audit log generation.

- **Phase 4 Task 004 (P04-T04): API Key Permissions**
  - Implemented granular API Key permissions system supporting `chat:completions`, `embeddings:create`, `images:generate`, `audio:transcribe`, `audio:speech`, and `models:list`.
  - Added `PermissionConstants` and default permission set (`['chat:completions', 'models:list']`) assigned to new API keys.
  - Implemented `PermissionValidator` for strict validation of permission strings (rejecting invalid strings with HTTP 400).
  - Implemented `PermissionResolver` and `PermissionGuard` for inspecting granted permissions against route requirements.
  - Created `PermissionMiddleware` (`requireApiKeyPermission`) Fastify route guard returning `403 Forbidden` (`API_KEY_PERMISSION_DENIED`) when an API key lacks required permissions.
  - Implemented `PATCH /v1/api-keys/:id/permissions` endpoint with Zod schema validation (`UpdateApiKeyPermissionsSchema`), user ownership verification, revoked key check, and `AuditLog` event (`API_KEY_UPDATE_PERMISSIONS`).
  - Added `ApiKeyPermissionService` and updated `ApiKeyController` to handle permission management.
  - Added `updatePermissions` repository method to `IApiKeyRepository`, `PrismaApiKeyRepository`, and `MockApiKeyRepository`.
  - Added error classes: `InvalidApiKeyPermissionError` (400) and `ApiKeyPermissionDeniedError` (403) in `errors/api-key.errors.ts`.
  - Built comprehensive unit & integration test suite in `apps/gateway/src/modules/api-keys/api-key-permissions.test.ts`.

- **Phase 4 Task 003 (P04-T03): API Key Management API**
  - Implemented full API key management endpoints in `apps/gateway/src/modules/api-keys/api-keys.routes.ts`: `GET /v1/api-keys`, `GET /v1/api-keys/:id`, `PATCH /v1/api-keys/:id`, and `DELETE /v1/api-keys/:id`.
  - Added repository methods (`findAllByUserId`, `findById`, `updateKey`, `revokeKey`) to `IApiKeyRepository`, `PrismaApiKeyRepository`, and `MockApiKeyRepository`.
  - Added `ApiKeyResponseDto`, `ApiKeyParamSchema`, `UpdateApiKeySchema` in `apps/gateway/src/modules/api-keys/dto/create-api-key.dto.ts`.
  - Implemented management error classes: `ApiKeyNotFoundError` (404), `ApiKeyAlreadyRevokedError` (400), `ApiKeyForbiddenError` (403) in `apps/gateway/src/modules/api-keys/errors/api-key.errors.ts`.
  - Added business use-case methods (`listApiKeys`, `getApiKey`, `updateApiKey`, `revokeApiKey`) to `ApiKeyService` with strict user isolation, date formatting, and AuditLog recording (`API_KEY_UPDATE`, `API_KEY_REVOKE`).
  - Added controller handlers in `ApiKeyController` enforcing JWT authentication context and Zod request validation.
  - Built comprehensive unit & integration test suite in `apps/gateway/src/modules/api-keys/api-key-management.test.ts` covering key listing, detail retrieval, updating, soft revocation, AuditLog recording, 404/403/400 error conditions, and cross-user access rejection.

- **Phase 4 Task 002 (P04-T02): API Key Authentication Middleware**
  - Created Fastify authentication middleware (`authenticateApiKey`, `requireApiKey`, `getRequestApiKey`) in `apps/gateway/src/modules/api-keys/middleware/api-key-auth.middleware.ts`.
  - Added support for `Authorization: Bearer sk_live_...` authentication headers with `extractKeyPrefix()` helper.
  - Implemented secure API key lookup via candidate keyPrefix querying (`findActiveByPrefix`) and Argon2id hash verification (`PasswordService.verify`).
  - Implemented automatic rejection for expired keys, revoked keys (deletedAt), missing headers, malformed Bearer strings, unknown key prefixes, and suspended or deleted user accounts.
  - Attached sanitized `request.apiKey` context (omitting `keyHash`) and authenticated `request.user` context to Fastify request objects.
  - Added fire-and-forget asynchronous updating of `lastUsedAt` timestamp upon successful authentication.
  - Added API key specific 401 error definitions (`InvalidApiKeyError`, `ApiKeyExpiredError`, `ApiKeyRevokedError`, `MissingApiKeyError`).
  - Added comprehensive unit and integration test suite in `apps/gateway/src/modules/api-keys/api-key-middleware.test.ts`.

- **Phase 3 Task 010 (P03-T10): Authentication Security Hardening**
  - Conducted complete security review and hardening across all authentication and authorization modules.
  - Hardened JWT sign and verify utilities (`jwt.util.ts` & `jwt.service.ts`) by enforcing `issuer` (`baseapikey-gateway`), `audience` (`baseapikey-api`), and strict `algorithm` restrictions (`['HS256']`).
  - Defended against timing-based email enumeration during login by introducing constant-time dummy Argon2id hash verification (`passwordService.verify`) in `LoginService` when non-existent emails are queried.
  - Reinforced Refresh Token Rotation (RTR) and token reuse detection in `RefreshTokenService` to automatically revoke all user sessions and log `CRITICAL` audit events upon replay detection.
  - Enhanced session revocation and expiry validation in `authenticate` middleware (`auth.middleware.ts`).
  - Added structured `AUTH_PERMISSION_DENIED` event warning logs to RBAC preHandler guards (`requireRole`, `requirePermission`).
  - Implemented request correlation headers (`X-Request-ID` and `X-Correlation-ID`) propagation in Gateway Fastify application (`app.ts`).
  - Published comprehensive security review report in [`docs/SECURITY_REVIEW.md`](file:///home/lansion/lanexora/baseapikey/docs/SECURITY_REVIEW.md) documenting audit findings, remediations, audit matrix, and future security recommendations.

- **Phase 3 Task 009 (P03-T09): Authentication Integration Testing**
  - Created authentication test setup, helpers, fixtures, and cleanup utilities in `apps/gateway/src/modules/auth/testing/auth-test-utils.ts`.
  - Built comprehensive end-to-end integration test suite in `apps/gateway/src/modules/auth/integration.test.ts` covering 9 integration test groups.
  - Verified User Registration workflow (success 201, duplicate email 409, duplicate username 409, invalid password 400, invalid email 400).
  - Verified User Login workflow (success 200, wrong password 401, unknown email 401, suspended account 401, deleted account 401).
  - Verified JWT Authentication & Token Lifecycle (valid token 200, expired token 401, invalid signature 401, tampered token 401).
  - Verified Refresh Token & Rotation workflow (success 200, expired token 401, revoked session 401, replay attack / reuse detection 401, invalid token 401).
  - Verified Logout & Session Revocation workflow (single session 204, all sessions 204, revoked token refresh rejection 401).
  - Verified Authentication Middleware & Route Protection (protected endpoint 200, missing header 401, invalid Bearer 401, unauthorized request 401).
  - Verified Role-Based Access Control (USER accessing USER 200, USER denied ADMIN 403, ADMIN accessing ADMIN 200).
  - Verified Session Management API (list sessions 200, session detail 200, revoke session 200, cross-user 403 access rejection).
  - Verified Audit Logging for all key authentication lifecycle events (`AUTH_REGISTER`, `AUTH_LOGIN_SUCCESS`, `AUTH_TOKEN_REFRESH`, `AUTH_SESSION_REVOKE`, `AUTH_LOGOUT`).

- **Phase 3 Task 008 (P03-T08): Session Management API**
  - Built production-ready Session Management API endpoints: `GET /v1/auth/sessions`, `GET /v1/auth/sessions/:id`, and `DELETE /v1/auth/sessions/:id`.
  - Implemented `SessionController`, `SessionService`, Zod validation schemas (`SessionParamsSchema`, `DeleteSessionQuerySchema`), and response DTOs (`SessionItemResponseDto`, `SessionDetailResponseDto`).
  - Extended `ISessionRepository` with `findActiveSessionsByUserId` and implemented it in both `InMemorySessionRepository` and `PrismaSessionRepository`.
  - Added safety confirmation rule for current session revocation (`?confirm=true`), returning HTTP 400 Bad Request when unconfirmed.
  - Enforced cross-user access authorization (returning 403 Forbidden for unauthorized access/revocation attempts on other users' sessions).
  - Integrated session revocation with `AuditLog` (`AUTH_SESSION_REVOKE`) capturing IP address, User Agent, and request ID.
  - Implemented unit & Fastify integration test suite `session.test.ts` verifying all session management operations with 100% pass rate.

- **Phase 1 Task 001 (P01-T01): Monorepo Initialization with Turborepo**
  - Initialized Turborepo project with pnpm workspaces.
  - Added root `package.json`, `pnpm-workspace.yaml`, and `turbo.json` with build, dev, lint, type-check, and test pipeline tasks.
  - Created directory layout matching architecture: `apps/gateway/`, `apps/dashboard/`, `apps/docs-site/`, `packages/database/`, `packages/shared/`, `packages/config/`, `packages/logger/`, `infrastructure/docker/`, and `infrastructure/k8s/`.
  - Added `.gitignore` configured for Node.js, Turborepo, Next.js, build artifacts, and environment files.
  - Executed `pnpm install` and verified workspace builds cleanly across all packages.
- **Phase 1 Task 002 (P01-T02): TypeScript Configuration**
  - Created shared TypeScript configuration package at `packages/config/tsconfig/`.
  - Defined `base.json` enforcing strict mode (`strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`, `forceConsistentCasingInFileNames: true`).
  - Defined `node.json` extending base with `module: "NodeNext"` and `target: "ES2022"`.
  - Defined `next.json` extending base with Next.js specific compiler options.
  - Configured `tsconfig.json` across all apps (`apps/gateway`, `apps/dashboard`, `apps/docs-site`) and packages (`packages/database`, `packages/shared`, `packages/config`, `packages/logger`) extending shared configs.
  - Verified `turbo run type-check` passes across all packages with zero errors.
- **Phase 1 Task 003 (P01-T03): ESLint & Prettier Configuration**
  - Created shared ESLint configs in `packages/config/eslint/`: `base.js`, `node.js`, and `next.js`.
  - Created shared Prettier config at `packages/config/prettier/index.js` (single quotes, trailing commas, 100 character line width, 2 spaces tab width).
  - Configured root `.prettierrc` delegating to `@baseapikey/config/prettier`.
  - Created local `.eslintrc.js` files across all apps and packages extending the shared ESLint configurations.
  - Integrated with Turborepo `lint` task and verified `turbo run lint` and `turbo run type-check` execute with zero errors across all workspace packages.
- **Phase 1 Task 004 (P01-T04): Environment Variable Management**
  - Established centralized environment variable validation system using Zod in `packages/shared/src/env/`.
  - Created `gateway.env.ts` defining `GatewayEnvSchema` and `parseGatewayEnv()` function to validate Gateway env vars (`DATABASE_URL`, `REDIS_URL`, `PORT`, `LOG_LEVEL`, `NINE_ROUTER_API_KEY`, etc.).
  - Created `dashboard.env.ts` defining `DashboardEnvSchema` and `parseDashboardEnv()` function to validate Dashboard env vars (`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`, `REDIS_URL`, etc.).
  - Created root `.env.example` documenting all configuration options with descriptive comments and default values.
  - Added unit test suite `env.test.ts` in `@baseapikey/shared` and verified `pnpm test`, `pnpm run type-check`, and `pnpm run lint` execute with 0 errors across all workspace packages.
- **Phase 1 Task 005 (P01-T05): Docker Compose for Local Development**
  - Created `infrastructure/docker/docker-compose.yml` provisioning PostgreSQL 16 Alpine and Redis 7 Alpine services for local development.
  - Configured PostgreSQL 16 Alpine on port 5432 with persistent volume `postgres_data`, default credentials matching `.env.example` (`POSTGRES_DB=baseapikey`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`), and `pg_isready` health check.
  - Configured Redis 7 Alpine on port 6379 with persistent volume `redis_data` and `redis-cli ping` health check.
  - Joined both services to bridge network `baseapikey-network` and verified valid YAML configuration.
- **Phase 1 Task 006 (P01-T06): Shared Logger Package & Environment Configuration**
  - Updated root `.env.example` with categorized sections (Application, Database, Redis, Authentication, AI Provider, Logging) and descriptive comments for each variable.
  - Added `env.loader.ts` to `packages/shared/src/env/` to provide a centralized environment loader module (`loadEnv()`) that fails fast with descriptive Zod validation errors on missing or invalid variables.
  - Implemented `@baseapikey/logger` package wrapping Pino for structured JSON logging (`createLogger()` factory in `packages/logger/src/logger.ts`).
  - Configured structured output (`timestamp`, `level`, `service`, `msg`), PII redaction for `authorization` headers, `password` fields, and `cookie` headers in `packages/logger/src/redaction.ts`.
  - Added `LOG_LEVEL` environment variable control and development pretty-printing via `pino-pretty`.
  - Added unit test suites and verified `pnpm test`, `pnpm run type-check`, and `pnpm run lint` execute with 0 errors across all workspace packages.
- **Phase 1 Task 007 (P01-T07): Logging Foundation & Shared Utilities Package**
  - Enhanced `@baseapikey/logger` with standard metadata (`timestamp`, `requestId`, `serviceName`, `environment`), all Pino log levels (`trace`, `debug`, `info`, `warn`, `error`, `fatal`), and request logging middleware in `packages/logger/src/middleware.ts` (`logIncomingRequest`, `logCompletedRequest`, `registerGlobalErrorHandlers`).
  - Initialized `packages/shared/` core utilities, constants, types, and error hierarchy:
    - `Result<T, E>` in `packages/shared/src/utils/result.util.ts`.
    - UUID v7 generator in `packages/shared/src/utils/id.util.ts`.
    - SHA-256 hash helper in `packages/shared/src/utils/hash.util.ts`.
    - Envelope API response types in `packages/shared/src/types/api.type.ts`.
    - Error code constants in `packages/shared/src/constants/error-codes.constant.ts`.
    - Role & permission constants in `packages/shared/src/constants/roles.constant.ts`.
    - `AppError` base class and domain subclasses in `packages/shared/src/errors/app-error.ts`.
  - Verified `pnpm run build`, `pnpm test`, `pnpm run type-check`, and `pnpm run lint` execute with 0 errors across all 7 workspace packages.
- **Phase 1 Task 008 (P01-T08): Health Check, Application Readiness & CI Workflow**
  - Implemented production-ready Clean Architecture health check module in `apps/gateway`:
    - `HealthService` (`apps/gateway/src/modules/health/health.service.ts`): provides `getHealth()`, `getLiveness()`, and `getReadiness()` with mocked Phase 1 DB/Redis readiness checks.
    - `HealthController` (`apps/gateway/src/modules/health/health.controller.ts`): handles JSON responses and returns HTTP 200 (healthy/ready) or 503 (unready).
    - `healthRoutes` (`apps/gateway/src/modules/health/health.routes.ts`): registers `GET /health`, `GET /health/live`, `GET /health/ready` endpoints.
    - Fastify App (`apps/gateway/src/app.ts`) and Server (`apps/gateway/src/index.ts`) integrated with request logging hooks and env loading.
  - Added GitHub Actions CI workflow in `.github/workflows/ci.yml` running `lint`, `type-check`, and `test` jobs on pull requests to `main` and `develop`.
  - Added health check integration test suite in `apps/gateway/src/modules/health/health.test.ts`.
  - Verified `pnpm run build`, `pnpm test`, `pnpm run type-check`, and `pnpm run lint` execute with 0 errors across all workspace packages.
- **Phase 1 Task 009 (P01-T09): CI/CD Foundation**
  - Created modular GitHub Actions CI pipeline under `.github/workflows/ci.yml`.
  - Configured jobs for TypeScript typecheck (`type-check`), ESLint code quality (`lint`), and project build (`build`) triggering on `push` and `pull_request` to `main` and `develop`.
  - Configured Node.js 24 and pnpm 11 dependency caching with `--frozen-lockfile` and concurrency cancellation.
  - Verified workflow syntax and ensured `pnpm run build`, `pnpm run type-check`, and `pnpm run lint` execute with 0 errors.
- **Phase 1 Task 010 (P01-T10): Git Hooks & Quality Gates**
  - Configured Husky git hooks in `.husky/pre-commit` and `.husky/commit-msg`.
  - Configured `lint-staged` in root `package.json` to run ESLint (`eslint --fix`) and Prettier (`prettier --write`) on staged files.
  - Configured Commitlint in `commitlint.config.js` extending `@commitlint/config-conventional` to enforce Conventional Commits specification.
  - Added workspace scripts to root `package.json`: `lint`, `lint:fix`, `typecheck`, `type-check`, `format`, `format:check`, `prepare`.
  - Documented workspace layout, scripts, Git workflow, and Conventional Commits conventions in `README.md`.
  - Verified Husky hooks, Commitlint validation, and monorepo build, typecheck, lint, and formatting with 0 errors.
- **Phase 2 Task 001 (P02-T01): Prisma Foundation**
  - Installed Prisma ORM (`prisma` and `@prisma/client`) in `packages/database/`.
  - Created `packages/database/prisma/schema.prisma` configuring PostgreSQL datasource reading from `DATABASE_URL` environment variable and `prisma-client-js` generator.
  - Created `packages/database/src/client.ts` exporting singleton `createPrismaClient()` factory and `prisma` client instance.
  - Added database scripts in `packages/database/package.json`: `db:generate`, `db:validate`, `db:push`, `db:migrate`, `db:studio`.
  - Verified `db:validate` and `db:generate` execute successfully and all workspace build, test, typecheck, lint, and format checks pass cleanly.
- **Phase 2 Task 002 (P02-T02): User Database Schema**
  - Implemented `User` model in `packages/database/prisma/schema.prisma` with UUID primary key, `UserRole` enum (`USER`, `ADMIN`), `UserStatus` enum (`ACTIVE`, `SUSPENDED`, `DELETED`), unique `email` and `username`, and soft-delete support (`deletedAt`).
  - Added indexes for `email`, `username`, `status`, and `deletedAt`.
- **Phase 2 Task 003 (P02-T03): API Key Database Schema**
  - Implemented `ApiKey` model in `packages/database/prisma/schema.prisma` with `ApiKeyStatus` enum (`ACTIVE`, `REVOKED`, `EXPIRED`), unique `keyHash`, `keyPrefix`, JSON `permissions`, and standard metadata timestamps.
  - Defined one-to-many relation `User -> ApiKey[]` with cascading delete constraint.
  - Added indexes on `userId`, `status`, and `keyPrefix`.
  - Verified `prisma format`, `db:validate`, `db:generate`, and full monorepo build, test, typecheck, and lint pass with 0 errors.
- **Phase 2 Task 004 (P02-T04): Usage Tracking Database Schema**
  - Implemented `Usage` model in `packages/database/prisma/schema.prisma` mapped to `usages` for recording AI API requests.
  - Added fields: UUID primary key, `userId` (FK to User), `apiKeyId` (FK to ApiKey), `provider`, `model`, `endpoint`, `requestId`, `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCost` (`Decimal(12, 6)`), `latencyMs`, `statusCode`, `clientIp`, `userAgent`, and `createdAt`.
  - Defined relations `User -> Usage[]` and `ApiKey -> Usage[]` (`onDelete: Cascade`).
  - Added indexes on `userId`, `apiKeyId`, `provider`, `model`, and `createdAt`.
- **Phase 2 Task 005 (P02-T05): AI Provider Database Schema**
  - Implemented `Provider` model in `packages/database/prisma/schema.prisma` mapped to `providers` supporting provider-agnostic integration (9Router, OpenAI, Anthropic, Gemini, Groq, OpenRouter, DeepSeek).
  - Added fields: UUID primary key, `name`, unique `slug`, `baseUrl`, `apiVersion`, `encryptedApiKey` (securing API keys), `status` (`ProviderStatus` enum: `ACTIVE`, `INACTIVE`, `MAINTENANCE`), `priority` (default 100), `timeoutMs` (default 60000), `maxRetries` (default 2), feature flags (`supportsStreaming`, `supportsImages`, `supportsEmbeddings`, `supportsAudio`, `supportsVision`), metadata JSON, and standard timestamps.
  - Added indexes on `slug`, `status`, and `priority`.
  - Verified `prisma format`, `db:validate`, `db:generate`, and full monorepo build, test, typecheck, and lint pass with 0 errors.
- **Phase 2 Task 006 (P02-T06): AI Model Catalog Database Schema**
  - Implemented `AIModel` model in `packages/database/prisma/schema.prisma` mapped to `ai_models` with `ModelCategory` enum (`CHAT`, `EMBEDDING`, `IMAGE`, `AUDIO`, `VISION`).
  - Added fields: UUID primary key, `providerId` (FK to Provider), `name`, `slug`, `displayName`, `category`, token limits (`contextWindow`, `maxOutputTokens`), pricing (`inputPricePerMillion`, `outputPricePerMillion`), capabilities (`supportsStreaming`, `supportsVision`, `supportsFunctionCalling`, `supportsJsonMode`, `supportsReasoning`), `isActive`, metadata JSON, and timestamps.
  - Defined relation `Provider -> AIModel[]` (`onDelete: Cascade`) and unique composite constraint `@@unique([providerId, slug])`.
  - Added indexes on `providerId`, `slug`, `category`, and `isActive`.
- **Phase 2 Task 007 (P02-T07): Audit Log Database Schema**
  - Implemented `AuditLog` model in `packages/database/prisma/schema.prisma` mapped to `audit_logs` with `AuditSeverity` enum (`INFO`, `WARNING`, `ERROR`, `CRITICAL`).
  - Added fields: UUID primary key, optional `userId` (FK to User), optional `apiKeyId` (FK to ApiKey), `action`, `resource`, optional `resourceId`, `ipAddress`, `userAgent`, `requestId`, metadata JSON, `severity`, and `createdAt` timestamp.
  - Configured foreign key relations `User? -> AuditLog` and `ApiKey? -> AuditLog` with `onDelete: SetNull` to preserve log history when accounts/keys are deleted.
  - Added indexes on `userId`, `apiKeyId`, `action`, `severity`, and `createdAt`.
  - Verified `prisma format`, `db:validate`, `db:generate`, and full monorepo build, test, typecheck, and lint pass with 0 errors.
- **Phase 2 Task 008 (P02-T08): Database Relations, Constraints & Optimization**
  - Reviewed and optimized all 6 Prisma models (`User`, `ApiKey`, `Usage`, `Provider`, `AIModel`, `AuditLog`) in `packages/database/prisma/schema.prisma`.
  - Verified foreign key cascading strategies (`onDelete: Cascade` for dependent assets like API keys, usage logs, provider models; `onDelete: SetNull` for audit log security preservation).
  - Added composite indexes for high-frequency queries: `[status, role]` on User, `[userId, status]` and `[keyPrefix, status]` on ApiKey, `[userId, createdAt]`, `[apiKeyId, createdAt]`, `[provider, model]`, and `[requestId]` on Usage, `[status, priority]` on Provider, `[providerId, isActive]`, `[slug, isActive]`, and `[category, isActive]` on AIModel, `[userId, createdAt]`, `[apiKeyId, createdAt]`, and `[action, severity]` on AuditLog.
  - Removed redundant standalone indexes on `@unique` columns (e.g. `Provider.slug`).
  - Verified `prisma format`, `db:validate`, `db:generate`, and full workspace build, unit test, type-check, lint, and format-check pass with 0 errors.
- **Phase 2 Task 009 (P02-T09): Initial Database Migration**
  - Generated initial SQL migration script in `packages/database/prisma/migrations/20260806000000_init_schema/migration.sql`.
  - Created 6 PostgreSQL enums (`user_role`, `user_status`, `api_key_status`, `provider_status`, `model_category`, `audit_severity`).
  - Created 6 core database tables (`users`, `api_keys`, `usages`, `providers`, `ai_models`, `audit_logs`) with primary keys, unique constraints, foreign keys, and indexes.
  - Verified `db:format`, `db:validate`, `db:generate`, and full workspace build, unit test, type-check, lint, and format-check pass with 0 errors.
- **Phase 2 Task 010 (P02-T10): Production Database Seed**
  - Implemented production database seed script in `packages/database/prisma/seed.ts`.
  - Added idempotent upsert for default Admin user with scrypt password hashing using credentials from environment variables (`ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME`).
  - Added idempotent upsert for default AI Provider (`9Router`, slug: `9router`, status: `ACTIVE`, priority: 100) using secrets from environment variables (`NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`).
  - Added idempotent upsert for default AI Models (`gpt-5`, `gpt-5-mini`, `claude-sonnet`, `gemini-2.5-pro`, `deepseek-chat`) with realistic pricing and capabilities.
  - Configured `"prisma": { "seed": "tsx prisma/seed.ts" }` and `db:seed` script in `packages/database/package.json`.
  - Verified full workspace build, unit test, type-check, lint, and format-check pass with 0 errors.
- **Phase 3 Task 001 (P03-T01): Authentication Foundation**
  - Created authentication module structure under `apps/gateway/src/modules/auth/` containing configuration, module container, constants, errors, services, types, and utilities.
  - Configured JWT environment variable schema in `@baseapikey/shared` for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`.
  - Implemented Argon2 password hashing and verification utility (`argon2.util.ts`) and `PasswordService`.
  - Implemented HS256 JWT sign and verification utility (`jwt.util.ts`) and `JwtService`.
  - Defined custom authentication errors extending `AppError`: `InvalidTokenError`, `TokenExpiredError`, `InvalidCredentialsError`, `AuthConfigError`.
  - Configured `allowBuilds` in `pnpm-workspace.yaml` for `argon2` native build script compilation.
  - Added unit test suite in `apps/gateway/src/modules/auth/auth.test.ts` testing Argon2 hashing, password verification, JWT token pair generation, payload validation, and token type verification.
  - Verified full monorepo build, unit test, type-check, lint, and format-check pass with 0 errors.
- **Phase 3 Task 002 (P03-T02): User Registration**
  - Created `RegisterRequestSchema` & `RegisterResponseDto` with strict Zod validation (email format, username 3-30 chars, password min 12 chars with uppercase, lowercase, number, and special character).
  - Created `IUserRepository` interface and `PrismaUserRepository` implementation using `@baseapikey/database`.
  - Created `RegisterService` enforcing email and username uniqueness (throwing 409 `ConflictError`), Argon2 password hashing (`PasswordService`), and creating default User with `role = USER`, `status = ACTIVE`, `emailVerified = false`.
  - Created `RegisterController` returning HTTP 201 Created with `{ id, email, username, fullName, createdAt }` and zero password hash leakage.
  - Implemented `POST /v1/auth/register` route handler and registered in Fastify gateway app with global `AppError` exception handling.
  - Re-exported Prisma client types & enums from `packages/database/src/client.ts`.
  - Added unit & integration test suite in `apps/gateway/src/modules/auth/register.test.ts` verifying registration flow, duplicate email/username rejection (409), and invalid password/email rejection (400).
  - Verified full monorepo build, unit test, type-check, lint, and format-check pass with 0 errors.
- **Phase 3 Task 003 (P03-T03): User Login**
  - Implemented `POST /v1/auth/login` endpoint adhering to Clean Architecture standards with zero direct Prisma access from controllers.
  - Defined `LoginRequestSchema` and `LoginResponseDto` with Zod validation.
  - Implemented `LoginService` handling user lookup by email, constant-time password verification using Argon2, updating `lastLoginAt`, audit log recording (`AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILED`), account status rejections (401 for `SUSPENDED` and `DELETED` accounts), and JWT token pair generation.
  - Implemented `ISessionRepository` interface and `InMemorySessionRepository` implementation storing ONLY SHA-256 hashes of refresh tokens (`hashSha256(refreshToken)`) to support multi-device sessions and prepare for future Refresh Token Rotation.
  - Implemented `ILoginRateLimiter` interface with `NoopLoginRateLimiter` default implementation.
  - Baked required JWT claims (`sub`, `email`, `role`, `apiVersion`, `tokenVersion`, `sessionId`) into access tokens.
  - Enforced security guidelines: return generic `AuthenticationError('Invalid email or password')` on invalid credentials to prevent email enumeration, and never log passwords, hashes, access tokens, or refresh tokens.
  - Added comprehensive unit & Fastify integration test suite (`apps/gateway/src/modules/auth/login.test.ts`) covering successful login, rate limiter execution, hashed refresh token storage, JWT claims verification, audit logs, generic 401 credential errors, and account status rejections.
  - Verified full workspace build, unit test, type-check, lint, and format-check pass with 0 errors across all 7 monorepo packages.
- **Phase 3 Task 004 (P03-T04): Refresh Token & Session Management**
  - Added Prisma `Session` model with fields `id`, `userId`, `refreshTokenHash`, `deviceId`, `deviceName`, `ipAddress`, `userAgent`, `expiresAt`, `lastUsedAt`, `revokedAt`, `createdAt`, `updatedAt` and index optimizations.
  - Updated `IUserRepository` and `ISessionRepository` interfaces (`findById`, `updateSession`, `revokeSession`, `revokeAllUserSessions`) and implemented `PrismaSessionRepository` & `InMemorySessionRepository`.
  - Defined `RefreshTokenRequestSchema` and `RefreshTokenResponseDto` using Zod validation.
  - Implemented `RefreshTokenService` enforcing JWT signature verification, session existence lookup, Argon2 refresh token hash verification, expired/revoked session rejections, suspended/deleted account checks, and Refresh Token Rotation (RTR).
  - Implemented Token Reuse & Theft Protection: automatically revokes ALL active user sessions (`revokeAllUserSessions`) and logs a `CRITICAL` audit event (`AUTH_REFRESH_TOKEN_REUSE_DETECTED`) if an already revoked/used refresh token is submitted.
  - Implemented `RefreshController` and registered `POST /v1/auth/refresh` route without direct Prisma access (Clean Architecture).
  - Added unit & integration test suite (`apps/gateway/src/modules/auth/refresh.test.ts`) covering token refresh, token rotation, session revocation, reuse detection, expired session rejection, suspended account rejection, and HTTP POST 200/400 validation with 100% pass rate.
  - Verified clean build, unit tests, type-check, lint, and formatting across all 7 workspace packages.
- **Phase 3 Task 005 (P03-T05): Logout & Session Revocation**
  - Created `LogoutRequestSchema` and `LogoutAllRequestSchema` DTOs using Zod validation.
  - Implemented `LogoutService` handling single session revocation and bulk user session revocation (`revokeAllUserSessions`), enforcing idempotency, invalidating associated refresh tokens, recording audit logs (`AUTH_LOGOUT_SUCCESS`, `AUTH_LOGOUT_ALL_SUCCESS`), and enforcing zero token/session ID exposure.
  - Implemented `LogoutController` adhering to Clean Architecture with zero direct Prisma access and returning HTTP 204 No Content for `/v1/auth/logout` and `/v1/auth/logout-all`.
  - Registered `POST /v1/auth/logout` and `POST /v1/auth/logout-all` routes in Fastify application.
  - Added comprehensive unit & Fastify integration test suite (`apps/gateway/src/modules/auth/logout.test.ts`) verifying single session logout via Bearer token / refresh token, rejection of revoked tokens by refresh service, idempotent logout, logout-all user session revocation, audit log recording, and HTTP 204 / 401 status codes with 100% pass rate.
  - Verified full workspace build, unit test, type-check, lint, and format-check pass with 0 errors across all 7 monorepo packages.
- **Phase 3 Task 006 (P03-T06): Authentication Middleware & Route Protection**
  - Created `authenticate` preHandler middleware reading `Authorization: Bearer <token>` header, verifying JWT signature, expiration, `tokenVersion`, and active session status.
  - Created `requireAuth` preHandler guard and `getRequestUser` helper to safely access `request.user` context.
  - Extended Fastify `FastifyRequest` type definition with `user?: AuthenticatedUser` context (`userId`, `email`, `role`, `sessionId`, `tokenVersion`).
  - Added standardized 401 error definitions: `MissingTokenError`, `InvalidTokenError`, `TokenExpiredError`, `InvalidTokenVersionError`, `UnauthorizedError`.
  - Implemented `MeController` and registered protected route `GET /v1/auth/me`.
  - Added unit & Fastify integration test suite (`apps/gateway/src/modules/auth/middleware.test.ts`) verifying valid tokens, missing headers, malformed Bearer formats, tampered signatures, expired tokens, revoked sessions, and public route accessibility with 100% pass rate.
  - Verified clean build, unit tests, type-check, lint, and formatting across all 7 workspace packages.
- **Phase 3 Task 007 (P03-T07): Role-Based Access Control (RBAC) System**
  - Defined `ROLES` (`ADMIN`, `USER`) and `PERMISSIONS` constants with role-permission mappings (`ROLE_PERMISSIONS`) in `rbac.constants.ts`.
  - Created `AuthorizationContext` in `rbac.context.ts` to resolve user permissions from `request.user.role` with deny-by-default for unmapped roles.
  - Created `requireRole` and `requirePermission` Fastify preHandler guards and `authorize` combined middleware in `rbac.middleware.ts`.
  - Defined 403 error classes in `rbac.errors.ts`: `ForbiddenError`, `MissingRoleError`, `MissingPermissionError`.
  - Registered RBAC protected endpoints in `auth.routes.ts` (`GET /v1/user/apikeys`, `GET /v1/admin/system`).
  - Added comprehensive unit & Fastify integration test suite (`apps/gateway/src/modules/auth/rbac.test.ts`) verifying `USER` accessing `USER` endpoints, `USER` denied `ADMIN` endpoints (403), `ADMIN` accessing `ADMIN` endpoints (200), missing permission (403), missing authentication (401), and permission resolution with 100% pass rate.
  - Verified full workspace build, unit test, type-check, lint, and format-check pass with 0 errors across all 7 monorepo packages.
