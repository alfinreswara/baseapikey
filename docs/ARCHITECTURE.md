# BaseAPIKey — Architecture Document

> **Version:** 1.0
> **Last Updated:** 2026-08-06
> **Status:** Draft
> **Author:** Architecture Team

---

## Table of Contents

1. [Overall Architecture](#1-overall-architecture)
2. [Folder Structure](#2-folder-structure)
3. [Monorepo Layout](#3-monorepo-layout)
4. [Request Flow](#4-request-flow)
5. [AI Gateway Flow](#5-ai-gateway-flow)
6. [Provider Abstraction](#6-provider-abstraction)
7. [Security Architecture](#7-security-architecture)
8. [Deployment Architecture](#8-deployment-architecture)
9. [Sequence Diagrams](#9-sequence-diagrams)

---

## 1. Overall Architecture

### 1.1 High-Level Overview

BaseAPIKey follows a **microservices-ready modular monolith** strategy. The platform separates into two primary planes:

- **Data Plane (Gateway):** High-throughput Fastify API that processes AI requests, enforces rate limits, and streams responses. Optimized for minimal latency.
- **Control Plane (Dashboard):** Next.js application providing user management, API key operations, analytics, and administrative functions.

Both planes share a common database schema, logging library, and type definitions through internal packages within a Turborepo monorepo.

```mermaid
graph TB
    subgraph Clients
        SDK[SDK / cURL / Application]
        Browser[Browser / Dashboard UI]
    end

    subgraph "BaseAPIKey Platform"
        subgraph "Data Plane"
            GW[Gateway API<br/>Fastify]
        end
        subgraph "Control Plane"
            DASH[Dashboard<br/>Next.js]
        end
        subgraph "Shared Infrastructure"
            PG[(PostgreSQL)]
            RD[(Redis)]
        end
    end

    subgraph "AI Providers"
        NR[9Router]
        FUTURE[Future Providers<br/>OpenAI / Anthropic / etc.]
    end

    SDK -->|API Key Auth| GW
    Browser -->|Session Auth| DASH
    GW --> PG
    GW --> RD
    GW -->|Provider Adapter| NR
    GW -.->|Future| FUTURE
    DASH --> PG
    DASH --> RD
```

### 1.2 Architectural Decisions Record (ADR)

| ID      | Decision                           | Rationale                                                                                        |
| ------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| ADR-001 | **Monorepo with Turborepo + pnpm** | Type safety across boundaries, shared packages, unified CI, simplified dependency management     |
| ADR-002 | **Fastify for Gateway**            | 2-3x faster than Express, native streaming support, schema-based validation, plugin architecture |
| ADR-003 | **Next.js 14+ for Dashboard**      | App Router for server components, built-in auth support, SSR for SEO, React ecosystem            |
| ADR-004 | **PostgreSQL as primary DB**       | ACID compliance critical for billing, JSONB for flexible metadata, mature ecosystem              |
| ADR-005 | **Redis for ephemeral state**      | Sub-millisecond rate limiting, caching, session store, async job queuing                         |
| ADR-006 | **Drizzle ORM**                    | Type-safe queries, lightweight (no runtime overhead), excellent migration tooling                |
| ADR-007 | **Clean Architecture in Gateway**  | Business logic isolation enables provider swapping, testability, and framework independence      |
| ADR-008 | **UUID v7 for primary keys**       | Time-ordered for B-tree efficiency, globally unique, no central coordination needed              |
| ADR-009 | **Async usage tracking**           | Decouples billing from request path, reduces gateway latency, enables batch processing           |
| ADR-010 | **OpenAI-compatible API format**   | Massive existing ecosystem, drop-in replacement, reduces developer learning curve                |

### 1.3 Technology Stack

| Layer            | Technology           | Version      | Purpose                                         |
| ---------------- | -------------------- | ------------ | ----------------------------------------------- |
| Language         | TypeScript           | 5.x (strict) | Type-safe development across all packages       |
| Runtime          | Node.js              | 20+ LTS      | Server-side execution                           |
| Monorepo         | Turborepo            | Latest       | Build orchestration, caching, task dependencies |
| Package Manager  | pnpm                 | 9+           | Fast, disk-efficient package management         |
| Gateway API      | Fastify              | 5.x          | High-performance HTTP framework                 |
| Dashboard        | Next.js              | 14+          | Full-stack React framework (App Router)         |
| Database         | PostgreSQL           | 16+          | Relational database (ACID, JSONB)               |
| Cache/Queue      | Redis                | 7+           | Rate limiting, caching, job queues              |
| ORM              | Drizzle ORM          | Latest       | Type-safe SQL, migrations                       |
| Auth (Dashboard) | NextAuth.js          | 5.x          | Session-based authentication                    |
| Validation       | Zod                  | 3.x          | Runtime type validation                         |
| Logging          | Pino                 | 9.x          | Structured JSON logging                         |
| Testing          | Vitest / Playwright  | Latest       | Unit / E2E testing                              |
| API Docs         | Scalar               | Latest       | OpenAPI 3.1 documentation                       |
| Monitoring       | Prometheus + Grafana | Latest       | Metrics collection and visualization            |
| Error Tracking   | Sentry               | Latest       | Exception monitoring and alerting               |
| CI/CD            | GitHub Actions       | —            | Automated testing and deployment                |
| Containers       | Docker               | Latest       | Application containerization                    |
| Orchestration    | Kubernetes           | 1.28+        | Production container orchestration              |

---

## 2. Folder Structure

```
baseapikey/
├── apps/
│   ├── gateway/                        # Data Plane — AI Gateway API (Fastify)
│   │   ├── src/
│   │   │   ├── domain/                 # Business entities & rules (no dependencies)
│   │   │   │   ├── entities/           # Core domain objects
│   │   │   │   │   ├── api-key.entity.ts
│   │   │   │   │   ├── model.entity.ts
│   │   │   │   │   ├── provider.entity.ts
│   │   │   │   │   └── request-log.entity.ts
│   │   │   │   ├── value-objects/      # Immutable domain primitives
│   │   │   │   │   ├── api-key-hash.vo.ts
│   │   │   │   │   ├── token-count.vo.ts
│   │   │   │   │   └── cost.vo.ts
│   │   │   │   └── errors/             # Domain-specific errors
│   │   │   │       ├── spending-limit-exceeded.error.ts
│   │   │   │       └── model-not-found.error.ts
│   │   │   │
│   │   │   ├── application/            # Use cases & ports (depends on domain only)
│   │   │   │   ├── use-cases/          # Application business logic
│   │   │   │   │   ├── chat-completion.use-case.ts
│   │   │   │   │   ├── list-models.use-case.ts
│   │   │   │   │   └── validate-api-key.use-case.ts
│   │   │   │   ├── ports/              # Interfaces for infrastructure
│   │   │   │   │   ├── provider-adapter.port.ts
│   │   │   │   │   ├── api-key-repository.port.ts
│   │   │   │   │   ├── model-repository.port.ts
│   │   │   │   │   ├── rate-limiter.port.ts
│   │   │   │   │   └── usage-tracker.port.ts
│   │   │   │   ├── dtos/               # Data transfer objects
│   │   │   │   │   ├── chat-completion.dto.ts
│   │   │   │   │   └── model-list.dto.ts
│   │   │   │   └── services/           # Application services
│   │   │   │       ├── cost-calculator.service.ts
│   │   │   │       └── token-counter.service.ts
│   │   │   │
│   │   │   ├── infrastructure/         # External implementations (depends on application + domain)
│   │   │   │   ├── database/           # Database repositories
│   │   │   │   │   ├── api-key.repository.ts
│   │   │   │   │   ├── model.repository.ts
│   │   │   │   │   └── request-log.repository.ts
│   │   │   │   ├── providers/          # AI provider adapters
│   │   │   │   │   ├── base-provider.adapter.ts
│   │   │   │   │   └── nine-router.adapter.ts
│   │   │   │   ├── cache/              # Redis implementations
│   │   │   │   │   ├── redis-rate-limiter.ts
│   │   │   │   │   └── redis-cache.ts
│   │   │   │   └── queue/              # Async job processing
│   │   │   │       └── usage-tracking.queue.ts
│   │   │   │
│   │   │   ├── presentation/           # HTTP layer (depends on application + domain)
│   │   │   │   ├── routes/             # Fastify route definitions
│   │   │   │   │   ├── chat-completions.route.ts
│   │   │   │   │   ├── models.route.ts
│   │   │   │   │   └── health.route.ts
│   │   │   │   ├── controllers/        # Request handlers
│   │   │   │   │   ├── chat-completions.controller.ts
│   │   │   │   │   └── models.controller.ts
│   │   │   │   ├── middleware/         # Fastify hooks & middleware
│   │   │   │   │   ├── auth.middleware.ts
│   │   │   │   │   ├── rate-limit.middleware.ts
│   │   │   │   │   ├── request-id.middleware.ts
│   │   │   │   │   └── error-handler.middleware.ts
│   │   │   │   └── validators/         # Zod schemas for requests
│   │   │   │       ├── chat-completion.validator.ts
│   │   │   │       └── common.validator.ts
│   │   │   │
│   │   │   ├── config/                 # App configuration
│   │   │   │   ├── env.ts              # Zod-validated env vars
│   │   │   │   ├── container.ts        # DI container setup
│   │   │   │   └── plugins.ts          # Fastify plugin registration
│   │   │   │
│   │   │   └── server.ts              # Application entry point
│   │   │
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── dashboard/                      # Control Plane — Admin & User Dashboard (Next.js)
│   │   ├── src/
│   │   │   ├── app/                    # Next.js App Router
│   │   │   │   ├── (auth)/             # Auth route group
│   │   │   │   │   ├── login/page.tsx
│   │   │   │   │   └── register/page.tsx
│   │   │   │   ├── (dashboard)/        # Authenticated route group
│   │   │   │   │   ├── layout.tsx      # Dashboard shell (sidebar, header)
│   │   │   │   │   ├── page.tsx        # Overview / home
│   │   │   │   │   ├── keys/page.tsx   # API key management
│   │   │   │   │   ├── usage/page.tsx  # Usage analytics
│   │   │   │   │   ├── models/page.tsx # Model catalog
│   │   │   │   │   ├── settings/page.tsx
│   │   │   │   │   └── admin/          # Admin-only pages
│   │   │   │   │       ├── providers/page.tsx
│   │   │   │   │       └── users/page.tsx
│   │   │   │   ├── api/                # Next.js API routes (dashboard API)
│   │   │   │   │   └── [...]/route.ts
│   │   │   │   ├── layout.tsx          # Root layout
│   │   │   │   └── page.tsx            # Landing / redirect
│   │   │   ├── components/             # React components
│   │   │   │   ├── ui/                 # Base UI components (Button, Card, etc.)
│   │   │   │   ├── charts/             # Usage chart components
│   │   │   │   ├── forms/              # Form components
│   │   │   │   └── layout/             # Layout components (Sidebar, Header)
│   │   │   ├── lib/                    # Client-side utilities
│   │   │   │   ├── api-client.ts       # Typed fetch wrapper
│   │   │   │   ├── auth.ts             # NextAuth configuration
│   │   │   │   └── utils.ts            # General utilities
│   │   │   ├── hooks/                  # Custom React hooks
│   │   │   │   ├── use-api-keys.ts
│   │   │   │   └── use-usage-stats.ts
│   │   │   └── styles/                 # Global styles
│   │   │       └── globals.css
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── docs-site/                      # Public API documentation (Scalar)
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── database/                       # Shared database package
│   │   ├── src/
│   │   │   ├── schema/                 # Drizzle table definitions
│   │   │   │   ├── users.ts
│   │   │   │   ├── organizations.ts
│   │   │   │   ├── api-keys.ts
│   │   │   │   ├── providers.ts
│   │   │   │   ├── models.ts
│   │   │   │   ├── requests.ts
│   │   │   │   ├── usage-records.ts
│   │   │   │   ├── rate-limit-rules.ts
│   │   │   │   ├── audit-logs.ts
│   │   │   │   ├── webhooks.ts
│   │   │   │   └── index.ts            # Barrel export
│   │   │   ├── migrations/             # Generated SQL migrations
│   │   │   ├── seeds/                  # Development seed data
│   │   │   │   └── seed.ts
│   │   │   ├── client.ts               # Database connection client
│   │   │   └── index.ts                # Package entry point
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── shared/                         # Shared types, utilities, constants
│   │   ├── src/
│   │   │   ├── types/                  # Shared TypeScript types
│   │   │   │   ├── api.type.ts         # API request/response envelopes
│   │   │   │   ├── auth.type.ts        # Auth-related types
│   │   │   │   └── provider.type.ts    # Provider interface types
│   │   │   ├── constants/              # Shared constants
│   │   │   │   ├── error-codes.constant.ts
│   │   │   │   ├── roles.constant.ts
│   │   │   │   └── limits.constant.ts
│   │   │   ├── utils/                  # Shared utility functions
│   │   │   │   ├── hash.util.ts
│   │   │   │   ├── id.util.ts          # UUID v7 generation
│   │   │   │   └── result.util.ts      # Result<T, E> type
│   │   │   ├── errors/                 # Shared error classes
│   │   │   │   ├── app-error.ts
│   │   │   │   ├── validation-error.ts
│   │   │   │   ├── auth-error.ts
│   │   │   │   └── not-found-error.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── config/                         # Shared configuration packages
│   │   ├── eslint/                     # ESLint configurations
│   │   │   ├── base.js
│   │   │   ├── next.js
│   │   │   └── node.js
│   │   ├── tsconfig/                   # TypeScript configurations
│   │   │   ├── base.json
│   │   │   ├── next.json
│   │   │   └── node.json
│   │   └── prettier/                   # Prettier configuration
│   │       └── index.js
│   │
│   └── logger/                         # Shared Pino-based logger
│       ├── src/
│       │   ├── logger.ts               # Logger factory
│       │   ├── redaction.ts            # PII redaction paths
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── infrastructure/
│   ├── docker/
│   │   ├── Dockerfile.gateway          # Gateway production build
│   │   ├── Dockerfile.dashboard        # Dashboard production build
│   │   ├── docker-compose.yml          # Local development
│   │   └── docker-compose.prod.yml     # Production deployment
│   ├── k8s/
│   │   ├── gateway/
│   │   │   ├── deployment.yaml
│   │   │   ├── service.yaml
│   │   │   └── hpa.yaml
│   │   ├── dashboard/
│   │   │   ├── deployment.yaml
│   │   │   ├── service.yaml
│   │   │   └── hpa.yaml
│   │   ├── ingress.yaml
│   │   ├── configmap.yaml
│   │   └── secrets.yaml
│   └── monitoring/
│       ├── prometheus.yml
│       ├── grafana-dashboards/
│       └── alertmanager.yml
│
├── docs/                               # Project documentation
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── CODING_STANDARD.md
│   └── TASKS.md
│
├── .github/
│   └── workflows/
│       ├── ci.yml                      # Lint, type-check, test on PR
│       ├── deploy-staging.yml          # Deploy to staging
│       └── deploy-production.yml       # Deploy to production
│
├── turbo.json                          # Turborepo pipeline configuration
├── pnpm-workspace.yaml                 # pnpm workspace definitions
├── package.json                        # Root package.json
├── .env.example                        # Environment variable template
├── .gitignore
├── .prettierrc
└── README.md
```

### 2.1 Directory Responsibilities

| Directory           | Responsibility                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/gateway`      | Core AI Gateway API — handles all incoming AI API requests, authentication, rate limiting, provider routing, and response streaming |
| `apps/dashboard`    | Web UI for users and admins — API key management, usage analytics, organization settings, provider administration                   |
| `apps/docs-site`    | Public-facing API documentation powered by Scalar with OpenAPI 3.1 spec                                                             |
| `packages/database` | Single source of truth for database schema (Drizzle), migrations, seeds, and connection client                                      |
| `packages/shared`   | Cross-cutting types, constants, utility functions, and error classes used by all apps                                               |
| `packages/config`   | Shared ESLint, TypeScript, and Prettier configurations for consistent code quality                                                  |
| `packages/logger`   | Pino-based structured logging wrapper with PII redaction                                                                            |
| `infrastructure/`   | Docker, Kubernetes, and monitoring configuration for all environments                                                               |

---

## 3. Monorepo Layout

### 3.1 Turborepo Configuration

```jsonc
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"],
    },
    "dev": {
      "cache": false,
      "persistent": true,
    },
    "lint": {
      "dependsOn": ["^build"],
    },
    "type-check": {
      "dependsOn": ["^build"],
    },
    "test": {
      "dependsOn": ["^build"],
    },
    "db:generate": {
      "cache": false,
    },
    "db:migrate": {
      "cache": false,
    },
    "db:seed": {
      "cache": false,
    },
  },
}
```

### 3.2 pnpm Workspace

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### 3.3 Package Dependency Graph

```mermaid
graph TD
    GW[apps/gateway] --> DB[packages/database]
    GW --> SHARED[packages/shared]
    GW --> LOGGER[packages/logger]
    GW --> CONFIG[packages/config]

    DASH[apps/dashboard] --> DB
    DASH --> SHARED
    DASH --> LOGGER
    DASH --> CONFIG

    DOCS[apps/docs-site] --> CONFIG

    DB --> SHARED
    LOGGER --> SHARED
```

### 3.4 Shared Package Consumption

Internal packages are referenced in `package.json` using the `workspace:*` protocol:

```jsonc
// apps/gateway/package.json
{
  "dependencies": {
    "@baseapikey/database": "workspace:*",
    "@baseapikey/shared": "workspace:*",
    "@baseapikey/logger": "workspace:*",
  },
}
```

### 3.5 Build Pipeline

1. **`packages/config`** — Built first (ESLint, TSConfig, Prettier configs)
2. **`packages/shared`** — Types and utilities (depends on nothing)
3. **`packages/logger`** — Logger wrapper (depends on shared)
4. **`packages/database`** — Schema and client (depends on shared)
5. **`apps/gateway`** — Gateway API (depends on database, shared, logger)
6. **`apps/dashboard`** — Dashboard UI (depends on database, shared, logger)
7. **`apps/docs-site`** — Documentation site (depends on config)

---

## 4. Request Flow

### 4.1 Complete Request Lifecycle

When a client sends a request to the BaseAPIKey gateway, it passes through these stages:

```
Client Request
    │
    ▼
┌─────────────────┐
│ 1. Receive       │  Gateway receives HTTP request
├─────────────────┤
│ 2. Request ID    │  Generate/forward X-Request-Id
├─────────────────┤
│ 3. Authenticate  │  Extract Bearer token → SHA-256 hash → DB lookup
├─────────────────┤
│ 4. Rate Limit    │  Sliding window check in Redis
├─────────────────┤
│ 5. Validate      │  Zod schema validation of request body
├─────────────────┤
│ 6. Spend Check   │  Verify org hasn't exceeded spending limit
├─────────────────┤
│ 7. Route         │  Resolve model → provider adapter
├─────────────────┤
│ 8. Transform     │  Normalize request to provider format
├─────────────────┤
│ 9. Forward       │  Send to AI provider (9Router)
├─────────────────┤
│ 10. Stream/Return│  Stream SSE chunks or return JSON response
├─────────────────┤
│ 11. Async Log    │  Queue: log usage, update counters, webhooks
└─────────────────┘
```

### 4.2 Request Flow Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as Gateway (Fastify)
    participant RD as Redis
    participant DB as PostgreSQL
    participant PA as Provider Adapter
    participant P as 9Router API
    participant Q as Async Queue

    C->>GW: POST /v1/chat/completions<br/>Authorization: Bearer bak_live_xxx

    Note over GW: Step 1-2: Receive & assign Request ID

    GW->>GW: Generate X-Request-Id (UUID v7)

    Note over GW,DB: Step 3: Authentication
    GW->>GW: SHA-256 hash the API key
    GW->>DB: SELECT * FROM api_keys WHERE key_hash = ?
    DB-->>GW: API Key record + org details

    alt Key Invalid / Inactive / Expired
        GW-->>C: 401 Unauthorized
    end

    Note over GW,RD: Step 4: Rate Limiting
    GW->>RD: EVALSHA sliding_window_check(key_id, org_id)
    RD-->>GW: { allowed: true, remaining: 95, reset: 1691234567 }

    alt Rate Limit Exceeded
        GW-->>C: 429 Too Many Requests + Retry-After header
    end

    Note over GW: Step 5: Request Validation
    GW->>GW: Zod.parse(request.body)

    alt Validation Failed
        GW-->>C: 400 Bad Request + validation errors
    end

    Note over GW,DB: Step 6: Spending Limit Check
    GW->>RD: GET org:{org_id}:spend_status
    RD-->>GW: spend_ok: true

    alt Spending Limit Exceeded
        GW-->>C: 402 Payment Required
    end

    Note over GW,PA: Step 7-8: Route & Transform
    GW->>PA: resolveProvider(model: "llama-3.1-70b")
    PA-->>GW: NineRouterAdapter
    GW->>PA: transformRequest(openai_format → provider_format)

    Note over PA,P: Step 9-10: Forward & Stream
    PA->>P: POST /chat/completions
    P-->>PA: SSE Stream (chunk 1)
    PA-->>GW: Normalized chunk 1
    GW-->>C: data: {"choices":[{"delta":{"content":"Hello"}}]}

    P-->>PA: SSE Stream (chunk N)
    PA-->>GW: Normalized chunk N
    GW-->>C: data: {"choices":[{"delta":{"content":"!"}}]}

    P-->>PA: [DONE]
    PA-->>GW: Stream complete + usage stats
    GW-->>C: data: [DONE]

    Note over GW,Q: Step 11: Async Processing
    GW->>Q: Push {request_id, tokens, cost, latency}
    Q->>DB: INSERT INTO requests (...)
    Q->>RD: INCRBY org:{org_id}:usage {cost}
    Q->>DB: UPSERT usage_records (daily aggregation)
```

---

## 5. AI Gateway Flow

### 5.1 Gateway Processing Pipeline

The AI Gateway implements a multi-stage pipeline for processing requests:

```mermaid
flowchart LR
    A[Incoming<br/>Request] --> B[Auth<br/>Middleware]
    B --> C[Rate Limit<br/>Middleware]
    C --> D[Validation<br/>Middleware]
    D --> E[Spend<br/>Check]
    E --> F[Model<br/>Resolver]
    F --> G[Request<br/>Transformer]
    G --> H[Provider<br/>Adapter]
    H --> I[Response<br/>Transformer]
    I --> J[Stream /<br/>Return]
    J --> K[Async<br/>Logger]
```

### 5.2 Streaming (SSE) Architecture

For streaming responses, the gateway uses Node.js readable streams piped through Fastify's reply:

```mermaid
sequenceDiagram
    participant Client
    participant GW as Gateway
    participant Adapter as Provider Adapter
    participant Provider as 9Router

    Client->>GW: POST /v1/chat/completions<br/>{stream: true}
    GW->>GW: Set Content-Type: text/event-stream
    GW->>Adapter: chatCompletion(request)
    Adapter->>Provider: HTTP POST (stream: true)

    loop For each SSE chunk
        Provider-->>Adapter: data: {chunk}
        Adapter->>Adapter: Normalize to OpenAI format
        Adapter-->>GW: Transformed chunk
        GW-->>Client: data: {normalized_chunk}\n\n
    end

    Provider-->>Adapter: data: [DONE]
    Adapter-->>GW: Stream end + usage summary
    GW-->>Client: data: [DONE]\n\n
    GW->>GW: Close stream, queue usage log
```

### 5.3 Circuit Breaker Pattern

The gateway implements a circuit breaker to prevent cascading failures:

```mermaid
stateDiagram-v2
    [*] --> Closed: Initial State
    Closed --> Open: Failure threshold reached<br/>(5 failures in 60s)
    Open --> HalfOpen: Cooldown period expires<br/>(30 seconds)
    HalfOpen --> Closed: Probe request succeeds
    HalfOpen --> Open: Probe request fails

    note right of Closed
        All requests pass through
        to the provider normally
    end note

    note right of Open
        All requests fail fast
        with 503 Service Unavailable
    end note

    note right of HalfOpen
        Single probe request allowed
        to test provider recovery
    end note
```

**Circuit Breaker Configuration:**

| Parameter         | Value      | Description                          |
| ----------------- | ---------- | ------------------------------------ |
| Failure Threshold | 5          | Failures needed to trip circuit      |
| Window Duration   | 60 seconds | Rolling window for counting failures |
| Cooldown Period   | 30 seconds | Time before probe attempt            |
| Timeout           | 30 seconds | Per-request timeout                  |
| Probe Count       | 1          | Requests allowed in half-open state  |

### 5.4 Error Handling & Retry Strategy

| Scenario             | Strategy                                 | Max Retries | Backoff            |
| -------------------- | ---------------------------------------- | ----------- | ------------------ |
| Provider returns 5xx | Retry with exponential backoff           | 2           | 1s, 3s             |
| Provider returns 429 | Respect `Retry-After` header             | 1           | Provider-specified |
| Network timeout      | Retry immediately (different connection) | 1           | 0s                 |
| Provider returns 4xx | Do not retry — return error to client    | 0           | —                  |
| Circuit breaker open | Fail fast — do not contact provider      | 0           | —                  |

---

## 6. Provider Abstraction

### 6.1 Strategy Pattern Design

The provider abstraction uses the Strategy Pattern, allowing the gateway to work with any AI provider through a common interface:

```mermaid
classDiagram
    class IProviderAdapter {
        <<interface>>
        +getName() string
        +chatCompletion(request: UnifiedChatRequest) AsyncIterable~StreamChunk~ | ChatResponse
        +listModels() Model[]
        +healthCheck() HealthStatus
        +validateConfig() boolean
    }

    class BaseProviderAdapter {
        <<abstract>>
        #httpClient: HttpClient
        #circuitBreaker: CircuitBreaker
        #config: ProviderConfig
        +chatCompletion(request) *
        +listModels() *
        +healthCheck() HealthStatus
        #executeWithCircuitBreaker(fn) Result
        #handleRetry(fn, maxRetries) Result
    }

    class NineRouterAdapter {
        -apiKey: string
        -baseUrl: string
        +chatCompletion(request)
        +listModels()
        -transformRequest(unified) NineRouterRequest
        -transformResponse(raw) UnifiedResponse
        -transformStreamChunk(chunk) StreamChunk
    }

    class OpenAIAdapter {
        -apiKey: string
        -baseUrl: string
        +chatCompletion(request)
        +listModels()
        -transformRequest(unified) OpenAIRequest
        -transformResponse(raw) UnifiedResponse
    }

    class AnthropicAdapter {
        -apiKey: string
        -baseUrl: string
        +chatCompletion(request)
        +listModels()
        -transformRequest(unified) AnthropicRequest
        -transformResponse(raw) UnifiedResponse
    }

    class ProviderFactory {
        -adapters: Map~string, IProviderAdapter~
        +getAdapter(providerSlug: string) IProviderAdapter
        +registerAdapter(adapter: IProviderAdapter) void
        +getAllAdapters() IProviderAdapter[]
    }

    class ProviderRouter {
        -factory: ProviderFactory
        -modelRegistry: ModelRegistry
        +resolveProvider(modelId: string) IProviderAdapter
        +resolveWithFallback(modelId: string) IProviderAdapter
    }

    IProviderAdapter <|.. BaseProviderAdapter
    BaseProviderAdapter <|-- NineRouterAdapter
    BaseProviderAdapter <|-- OpenAIAdapter
    BaseProviderAdapter <|-- AnthropicAdapter
    ProviderFactory --> IProviderAdapter : manages
    ProviderRouter --> ProviderFactory : uses
```

### 6.2 Provider Interface Contract

```typescript
interface IProviderAdapter {
  /** Unique provider slug (e.g., '9router', 'openai') */
  getName(): string;

  /** Execute a chat completion — returns stream or complete response */
  chatCompletion(
    request: UnifiedChatRequest,
    options: RequestOptions,
  ): Promise<ChatResponse | AsyncIterable<StreamChunk>>;

  /** List models available from this provider */
  listModels(): Promise<ProviderModel[]>;

  /** Perform a health check against this provider */
  healthCheck(): Promise<HealthStatus>;

  /** Validate provider configuration on startup */
  validateConfig(): boolean;
}
```

### 6.3 Adding a New Provider (Step-by-Step)

1. **Create adapter file:** `infrastructure/providers/new-provider.adapter.ts`
2. **Extend `BaseProviderAdapter`** and implement all abstract methods
3. **Implement `transformRequest()`** to convert unified format → provider format
4. **Implement `transformResponse()`** to convert provider format → unified format
5. **Implement `transformStreamChunk()`** if provider supports streaming
6. **Register in `ProviderFactory`** during container setup
7. **Add provider record** to `providers` table via migration/seed
8. **Add model records** to `models` table with pricing data
9. **Configure environment variables** for the provider's API key
10. **Write integration tests** against the provider's API

---

## 7. Security Architecture

### 7.1 Authentication Flows

The platform uses two distinct authentication mechanisms:

```mermaid
flowchart TB
    subgraph "Gateway Authentication (API Key)"
        A1[Client sends<br/>Authorization: Bearer bak_live_xxx]
        A2[Extract key from header]
        A3[SHA-256 hash the key]
        A4[Lookup hash in api_keys table]
        A5{Key found<br/>& active?}
        A6[Attach org context<br/>to request]
        A7[Return 401<br/>Unauthorized]

        A1 --> A2 --> A3 --> A4 --> A5
        A5 -->|Yes| A6
        A5 -->|No| A7
    end

    subgraph "Dashboard Authentication (Session)"
        B1[User opens<br/>dashboard in browser]
        B2[NextAuth.js<br/>login page]
        B3[Verify credentials<br/>or OAuth]
        B4[Create JWT session]
        B5[Set HttpOnly<br/>secure cookie]
        B6[Subsequent requests<br/>include cookie]
        B7[Verify session<br/>on each request]

        B1 --> B2 --> B3 --> B4 --> B5 --> B6 --> B7
    end
```

### 7.2 API Key Security

| Aspect             | Implementation                                                         |
| ------------------ | ---------------------------------------------------------------------- |
| **Generation**     | `crypto.randomBytes(32)` → Base62 encoding → prefixed with `bak_live_` |
| **Storage**        | Only SHA-256 hash stored in `api_keys.key_hash`                        |
| **Identification** | First 12 characters stored in `api_keys.key_prefix` for display        |
| **Comparison**     | `crypto.timingSafeEqual()` for constant-time hash comparison           |
| **Display**        | Full key shown once at creation, never retrievable again               |
| **Revocation**     | Soft-delete sets `deleted_at`, instantly blocks validation             |

### 7.3 Authorization Model (RBAC)

```mermaid
graph TD
    subgraph Roles
        ADMIN[Platform Admin]
        OWNER[Org Owner]
        MEMBER[Org Member]
    end

    subgraph Permissions
        P1[Manage all orgs & users]
        P2[Manage providers & models]
        P3[View system metrics]
        P4[Manage org settings]
        P5[Invite/remove members]
        P6[Create/revoke API keys]
        P7[View usage analytics]
        P8[Use API keys]
    end

    ADMIN --> P1 & P2 & P3 & P4 & P5 & P6 & P7 & P8
    OWNER --> P4 & P5 & P6 & P7 & P8
    MEMBER --> P6 & P7 & P8
```

| Role        | Scope         | Capabilities                                                |
| ----------- | ------------- | ----------------------------------------------------------- |
| `admin`     | Platform-wide | Full system access — manage providers, users, view all orgs |
| `org_owner` | Organization  | Manage org settings, members, billing, all API keys         |
| `member`    | Organization  | Create/revoke own API keys, view org usage                  |

### 7.4 Security Layers

| Layer                | Implementation                                                                |
| -------------------- | ----------------------------------------------------------------------------- |
| **Input Validation** | Zod schemas on all endpoints with max length/count constraints                |
| **SQL Injection**    | Parameterized queries via Drizzle ORM (no raw SQL)                            |
| **XSS Prevention**   | Content-Security-Policy headers via Helmet                                    |
| **CSRF**             | SameSite cookies + CSRF tokens in dashboard                                   |
| **CORS**             | Configurable allowed origins (wildcard for gateway, restricted for dashboard) |
| **Request Size**     | Fastify body limit: 1MB default, 10MB for multimodal                          |
| **HTTP Headers**     | Helmet.js (X-Frame-Options, X-Content-Type-Options, etc.)                     |
| **Secrets**          | Environment variables, never committed to code                                |
| **Dependencies**     | Automated `npm audit` + Dependabot in CI                                      |
| **PII Redaction**    | Pino redaction paths strip API keys, passwords, auth headers from logs        |
| **Rate Limiting**    | Redis sliding window prevents brute-force and DDoS                            |

---

## 8. Deployment Architecture

### 8.1 Environment Overview

| Environment           | Infrastructure              | Purpose                          |
| --------------------- | --------------------------- | -------------------------------- |
| **Local Development** | Docker Compose + `pnpm dev` | Developer workstation            |
| **CI/CD**             | GitHub Actions              | Automated testing + image builds |
| **Staging**           | Docker Compose or K8s       | Pre-production validation        |
| **Production**        | Kubernetes                  | Scalable, resilient deployment   |

### 8.2 Production Deployment Diagram

```mermaid
flowchart TB
    subgraph Internet
        CLI[API Clients / SDKs]
        BRW[Browser Users]
    end

    subgraph "Load Balancer"
        LB[Nginx / Cloud LB<br/>TLS Termination]
    end

    subgraph "Kubernetes Cluster"
        subgraph "Gateway Pods (HPA: 2-20)"
            GW1[Gateway Pod 1]
            GW2[Gateway Pod 2]
            GWN[Gateway Pod N]
        end
        subgraph "Dashboard Pods (HPA: 2-5)"
            D1[Dashboard Pod 1]
            D2[Dashboard Pod 2]
        end
        subgraph "Workers"
            W1[Usage Worker 1]
            W2[Webhook Worker 1]
        end
    end

    subgraph "Managed Services"
        PG[(PostgreSQL<br/>Primary + Replica)]
        PGBOUNCE[PgBouncer<br/>Connection Pool]
        RD[(Redis Cluster<br/>3 nodes)]
    end

    subgraph "Monitoring"
        PROM[Prometheus]
        GRAF[Grafana]
        SENT[Sentry]
    end

    CLI -->|HTTPS| LB
    BRW -->|HTTPS| LB
    LB --> GW1 & GW2 & GWN
    LB --> D1 & D2

    GW1 & GW2 & GWN --> PGBOUNCE --> PG
    GW1 & GW2 & GWN --> RD
    D1 & D2 --> PGBOUNCE
    D1 & D2 --> RD

    W1 & W2 --> PGBOUNCE
    W1 & W2 --> RD

    GW1 & D1 & W1 -.-> PROM
    PROM -.-> GRAF
    GW1 & D1 -.-> SENT
```

### 8.3 Kubernetes Resources

| Resource       | Application  | Configuration                                             |
| -------------- | ------------ | --------------------------------------------------------- |
| **Deployment** | Gateway      | 2-20 replicas, CPU/memory limits, rolling update strategy |
| **Deployment** | Dashboard    | 2-5 replicas, CPU/memory limits                           |
| **Deployment** | Usage Worker | 1-3 replicas                                              |
| **Service**    | Gateway      | ClusterIP, port 3000                                      |
| **Service**    | Dashboard    | ClusterIP, port 3001                                      |
| **Ingress**    | Both         | TLS termination, path-based routing                       |
| **HPA**        | Gateway      | Scale on CPU (70%) and custom metrics (RPS)               |
| **ConfigMap**  | All          | Non-sensitive configuration                               |
| **Secret**     | All          | API keys, DB credentials, JWT secrets                     |
| **PDB**        | Gateway      | minAvailable: 1 (ensure zero-downtime)                    |

### 8.4 CI/CD Pipeline

```mermaid
flowchart LR
    subgraph "PR Pipeline"
        A[Push / PR] --> B[Install deps]
        B --> C[Lint + Type Check]
        C --> D[Unit Tests]
        D --> E[Build Check]
    end

    subgraph "Deploy Pipeline"
        F[Merge to main] --> G[Build Docker Images]
        G --> H[Push to Registry]
        H --> I[Run Migrations]
        I --> J[Deploy to Staging]
        J --> K[Smoke Tests]
        K --> L{Approve?}
        L -->|Yes| M[Deploy to Production]
        L -->|No| N[Rollback]
    end
```

### 8.5 Local Development Setup

```yaml
# docker-compose.yml (simplified)
services:
  postgres:
    image: postgres:16-alpine
    ports: ['5432:5432']
    environment:
      POSTGRES_DB: baseapikey
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

---

## 9. Sequence Diagrams

### 9.1 API Key Creation Flow

```mermaid
sequenceDiagram
    participant User
    participant Dashboard as Dashboard UI
    participant API as Dashboard API
    participant DB as PostgreSQL

    User->>Dashboard: Click "Create API Key"
    Dashboard->>Dashboard: Open modal (name input)
    User->>Dashboard: Enter name, click Create
    Dashboard->>API: POST /api/dashboard/keys<br/>{name: "Production Key"}
    API->>API: Verify session + RBAC
    API->>API: Generate random key<br/>(crypto.randomBytes → bak_live_abc123...)
    API->>API: SHA-256 hash the key
    API->>DB: INSERT INTO api_keys<br/>(name, key_prefix, key_hash, org_id, created_by_id)
    DB-->>API: Success
    API-->>Dashboard: { key: "bak_live_abc123...", id: "uuid", name: "Production Key" }
    Dashboard->>Dashboard: Show key in modal<br/>(copy button, one-time display warning)
    User->>Dashboard: Copy key, close modal

    Note over Dashboard: Key is NEVER shown again<br/>Only prefix displayed in list view
```

### 9.2 Provider Failover Flow

```mermaid
sequenceDiagram
    participant GW as Gateway
    participant CB1 as Circuit Breaker<br/>(9Router)
    participant P1 as 9Router API
    participant CB2 as Circuit Breaker<br/>(Fallback)
    participant P2 as Fallback Provider

    GW->>CB1: Execute request
    CB1->>CB1: Check circuit state

    alt Circuit CLOSED (healthy)
        CB1->>P1: Forward request
        P1--xCB1: 503 Service Unavailable
        CB1->>CB1: Record failure (4/5 threshold)
        CB1-->>GW: Provider error

        GW->>GW: Check fallback providers

        alt Fallback available
            GW->>CB2: Execute with fallback
            CB2->>P2: Forward request
            P2-->>CB2: 200 OK + response
            CB2-->>GW: Success
            GW-->>GW: Return response to client
        else No fallback
            GW-->>GW: Return 502 Bad Gateway
        end

    else Circuit OPEN (tripped)
        CB1-->>GW: Fail fast — circuit open
        GW->>GW: Attempt fallback immediately
    end
```

### 9.3 Rate Limiting Decision Flow

```mermaid
sequenceDiagram
    participant Request
    participant MW as Rate Limit Middleware
    participant RD as Redis

    Request->>MW: Incoming request (api_key_id, org_id)

    Note over MW,RD: Step 1: Check API Key rate limit
    MW->>RD: EVALSHA sliding_window<br/>(key: ratelimit:key:{key_id}, window: 60s)
    RD-->>MW: {count: 42, limit: 100}

    alt Key limit exceeded
        MW-->>Request: 429 Too Many Requests<br/>X-RateLimit-Limit: 100<br/>X-RateLimit-Remaining: 0<br/>X-RateLimit-Reset: 1691234567
    end

    Note over MW,RD: Step 2: Check Org rate limit
    MW->>RD: EVALSHA sliding_window<br/>(key: ratelimit:org:{org_id}, window: 60s)
    RD-->>MW: {count: 350, limit: 1000}

    alt Org limit exceeded
        MW-->>Request: 429 Too Many Requests
    end

    Note over MW: Step 3: Set response headers
    MW->>MW: Attach X-RateLimit-* headers
    MW-->>Request: Continue to next middleware
```

### 9.4 Webhook Delivery Flow

```mermaid
sequenceDiagram
    participant System as Core System
    participant Queue as Redis Queue
    participant Worker as Webhook Worker
    participant DB as PostgreSQL
    participant EP as External Endpoint

    System->>Queue: LPUSH webhook_queue<br/>{webhook_id, event, payload}

    loop Worker polling
        Queue-->>Worker: BRPOP webhook_queue
        Worker->>DB: SELECT * FROM webhooks WHERE id = ?
        DB-->>Worker: Webhook config (url, secret, events)
        Worker->>Worker: Sign payload with HMAC-SHA256
        Worker->>EP: POST {url}<br/>X-Signature: sha256=abc...<br/>Body: {event, data, timestamp}

        alt Success (2xx)
            EP-->>Worker: 200 OK
            Worker->>DB: INSERT webhook_deliveries<br/>(status: delivered)
            Worker->>DB: UPDATE webhooks<br/>SET failure_count = 0
        else Failure (5xx / timeout)
            EP--xWorker: 500 / timeout
            Worker->>DB: INSERT webhook_deliveries<br/>(status: failed, attempt: 1)
            Worker->>DB: UPDATE webhooks<br/>SET failure_count = failure_count + 1

            alt failure_count < 5
                Worker->>Queue: LPUSH webhook_queue<br/>(with exponential backoff delay)
            else Too many failures
                Worker->>DB: UPDATE webhooks<br/>SET is_active = false
                Note over Worker: Webhook auto-disabled after<br/>5 consecutive failures
            end
        end
    end
```

### 9.5 Usage Aggregation Flow

```mermaid
sequenceDiagram
    participant GW as Gateway
    participant RD as Redis
    participant Worker as Usage Worker
    participant DB as PostgreSQL

    Note over GW: After each completed request

    GW->>RD: LPUSH usage_queue<br/>{org_id, key_id, model_id, tokens, cost, latency}
    GW->>RD: INCRBY org:{org_id}:spend {cost_cents}

    Note over Worker: Batch processing (every 5s or 100 events)

    loop Batch cycle
        Worker->>RD: LRANGE + LTRIM usage_queue (batch of 100)
        RD-->>Worker: [{event1}, {event2}, ...]

        Worker->>DB: INSERT INTO requests (...)<br/>VALUES (...), (...), (...) -- batch insert

        Worker->>DB: INSERT INTO usage_records (...)<br/>ON CONFLICT (org, key, model, date)<br/>DO UPDATE SET<br/>  request_count = request_count + ?,<br/>  total_tokens = total_tokens + ?,<br/>  total_cost = total_cost + ?
    end
```

---

## Appendix: Key Design Principles

| Principle                     | Application                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| **Separation of Concerns**    | Data plane (gateway) and control plane (dashboard) are independent applications               |
| **Dependency Inversion**      | Use cases depend on port interfaces, not concrete implementations                             |
| **Stateless Gateway**         | No server-side sessions — all state in PostgreSQL/Redis, enabling horizontal scaling          |
| **Async by Default**          | Usage tracking, webhooks, and aggregation are async to minimize request latency               |
| **Fail Open vs. Fail Closed** | Rate limiting fails open on Redis failure (allow traffic); Auth fails closed (deny traffic)   |
| **Defense in Depth**          | Multiple security layers: input validation → auth → rate limit → spend check → CORS → headers |
