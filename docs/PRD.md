# BaseAPIKey — Product Requirements Document (PRD)

> **Version:** 1.0
> **Last Updated:** 2026-08-06
> **Status:** Draft
> **Author:** Architecture Team

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Goals](#2-goals)
3. [Features](#3-features)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Success Metrics](#6-success-metrics)
7. [Scope (MVP / v1.0)](#7-scope-mvp--v10)
8. [Out of Scope (Future Versions)](#8-out-of-scope-future-versions)

---

## 1. Product Overview

### 1.1 What is BaseAPIKey?

**BaseAPIKey** is a production-ready, unified AI Gateway Platform — comparable to [OpenRouter](https://openrouter.ai) — that provides developers, startups, and enterprises with a **single API endpoint** to access multiple AI language model providers through one integration.

At launch, BaseAPIKey will use **9Router** as its primary AI provider, with the architecture designed from day one to support additional providers (OpenAI, Anthropic, Google Gemini, Mistral, Cohere, etc.) in future releases.

### 1.2 Problem Statement

Integrating with multiple AI providers is costly and complex:

- Each provider has a **different API format**, authentication scheme, and pricing model.
- Developers must build and maintain **separate integrations** per provider.
- There is no unified way to **track usage, costs, and performance** across providers.
- Provider outages require **manual failover** logic.
- Managing API keys across multiple providers is a **security burden**.

### 1.3 Solution

BaseAPIKey eliminates this complexity by offering:

| Capability               | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| **Single API Key**       | One key to access all supported AI models                   |
| **Unified API Format**   | OpenAI-compatible request/response format                   |
| **Unified Billing**      | Single bill across all providers and models                 |
| **Provider Abstraction** | Swap or add providers without client changes                |
| **Automatic Failover**   | Route to healthy providers when one is down                 |
| **Usage Analytics**      | Centralized dashboard for cost, latency, and token tracking |

### 1.4 Target Users

| Persona                  | Description                                     | Key Need                                          |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------- |
| **Individual Developer** | Building AI-powered side projects or prototypes | Simple API access, low cost                       |
| **Startup Team**         | Shipping AI features in production apps         | Unified billing, usage controls, team management  |
| **Enterprise**           | Operating AI at scale across multiple teams     | RBAC, audit logs, spending limits, SLA guarantees |
| **AI Researcher**        | Comparing model performance across providers    | Model catalog, playground, analytics              |

### 1.5 Value Proposition

> _"One API key. Every AI model. Total control."_

- **For Developers:** Reduce integration time from weeks to minutes.
- **For Teams:** Centralized API key management with role-based access.
- **For Finance:** Single invoice with granular cost attribution per model, key, and team.
- **For Operations:** Real-time health monitoring, automatic failover, and alerting.

---

## 2. Goals

### 2.1 Primary Goals

| #   | Goal                                         | Metric                                                      |
| --- | -------------------------------------------- | ----------------------------------------------------------- |
| G1  | Reduce AI integration complexity             | Single SDK/API integration replaces N provider integrations |
| G2  | Provide unified billing across all providers | One cost dashboard, one invoice per organization            |
| G3  | Abstract provider differences                | OpenAI-compatible API works with all providers              |
| G4  | Enable provider resilience                   | Automatic failover when providers are degraded              |
| G5  | Deliver real-time usage visibility           | Per-request cost tracking with <5 minute reporting delay    |

### 2.2 Secondary Goals

| #   | Goal                            | Metric                                                |
| --- | ------------------------------- | ----------------------------------------------------- |
| G6  | Cost optimization insights      | Surface cheaper models that meet quality requirements |
| G7  | Rich analytics                  | Latency, token usage, error rates by model/key/time   |
| G8  | Developer experience excellence | <5 minute time-to-first-API-call                      |
| G9  | Team collaboration              | Multi-user organizations with role-based permissions  |

### 2.3 Business Goals

| #   | Goal                            | Target                                                    |
| --- | ------------------------------- | --------------------------------------------------------- |
| G10 | Revenue via usage-based pricing | Margin on per-token pricing passed through from providers |
| G11 | Platform growth                 | 1,000+ monthly active API keys within 6 months            |
| G12 | Enterprise adoption             | 10+ enterprise accounts within 12 months                  |
| G13 | Developer community             | Active documentation site, SDK, and playground            |

---

## 3. Features

### 3.1 API Gateway

| Feature                  | Description                                            |
| ------------------------ | ------------------------------------------------------ |
| Unified Endpoint         | Single `/v1/chat/completions` endpoint for all models  |
| OpenAI Compatibility     | Request/response format matches OpenAI API spec        |
| Request Routing          | Automatic model → provider resolution                  |
| Streaming Support        | Server-Sent Events (SSE) for real-time token streaming |
| Model Aliasing           | Map friendly names to provider-specific model IDs      |
| Request/Response Logging | Full request lifecycle tracking (async)                |

### 3.2 Authentication & API Keys

| Feature        | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| Key Generation | Cryptographically secure key generation with `bak_live_` prefix |
| Key Revocation | Instant key deactivation with soft-delete                       |
| Key Scoping    | Restrict keys to specific models or endpoints                   |
| Key Rotation   | Generate new key, deprecate old key with grace period           |
| Key Expiration | Optional TTL-based automatic expiry                             |
| Secure Storage | Only SHA-256 hash stored; plain key shown once at creation      |

### 3.3 Provider Management

| Feature            | Description                                             |
| ------------------ | ------------------------------------------------------- |
| Provider Registry  | Database-driven provider configuration                  |
| Model Catalog      | Browseable catalog of all available models with pricing |
| Health Monitoring  | Periodic health checks with status tracking             |
| Automatic Failover | Route to backup provider on primary failure             |
| Circuit Breaker    | Prevent cascade failures from unhealthy providers       |
| Priority Routing   | Configurable provider preference ordering               |

### 3.4 Usage & Billing

| Feature          | Description                                         |
| ---------------- | --------------------------------------------------- |
| Token Counting   | Accurate input/output token measurement per request |
| Cost Calculation | Real-time cost computation based on model pricing   |
| Usage Tracking   | Async aggregation to daily usage rollups            |
| Spending Limits  | Hard caps per organization and per API key          |
| Usage Alerts     | Notifications at 75%, 90%, 100% of spending limit   |
| Usage Export     | CSV/JSON export of usage data                       |

### 3.5 Rate Limiting

| Feature            | Description                                             |
| ------------------ | ------------------------------------------------------- |
| Sliding Window     | Redis-based sliding window rate limiting                |
| Per-Key Limits     | Requests per minute (RPM) and per day (RPD) per API key |
| Per-Org Limits     | Organization-level aggregate limits                     |
| Per-Model Limits   | Model-specific rate caps                                |
| Burst Handling     | Short burst allowance with sustained rate enforcement   |
| Rate Limit Headers | Standard `X-RateLimit-*` headers in every response      |

### 3.6 Dashboard

| Feature               | Description                                           |
| --------------------- | ----------------------------------------------------- |
| **User Dashboard**    |                                                       |
| Usage Overview        | Charts showing cost, tokens, and requests over time   |
| API Key Management    | Create, view, revoke, and copy API keys               |
| Model Catalog         | Browse available models with pricing and capabilities |
| Organization Settings | Manage team members, roles, and billing               |
| **Admin Dashboard**   |                                                       |
| Provider Management   | Add, configure, and monitor AI providers              |
| User Management       | View and manage all platform users                    |
| System Health         | Real-time provider health and gateway metrics         |
| Global Analytics      | Platform-wide usage and revenue metrics               |

### 3.7 Developer Experience

| Feature          | Description                                               |
| ---------------- | --------------------------------------------------------- |
| OpenAI Drop-in   | Change base URL and API key — existing OpenAI code works  |
| Interactive Docs | Scalar-powered API documentation with try-it-out          |
| Model Playground | In-browser chat interface to test models                  |
| SDKs             | TypeScript SDK (future: Python, Go)                       |
| Error Messages   | Clear, actionable error messages with documentation links |

### 3.8 Security

| Feature            | Description                                           |
| ------------------ | ----------------------------------------------------- |
| API Key Hashing    | SHA-256 hashed storage, never plain text              |
| PII Redaction      | Automatic redaction in all logs                       |
| CORS Configuration | Configurable allowed origins                          |
| IP Allowlisting    | Optional per-org IP restrictions                      |
| Audit Logging      | Immutable log of all administrative actions           |
| Encryption         | TLS 1.3 in transit, AES-256 at rest for provider keys |

### 3.9 Observability

| Feature            | Description                                        |
| ------------------ | -------------------------------------------------- |
| Structured Logging | JSON logs with request correlation IDs             |
| Metrics            | Prometheus metrics for latency, throughput, errors |
| Dashboards         | Grafana templates for operational monitoring       |
| Error Tracking     | Sentry integration for exception alerting          |
| Health Checks      | Liveness and readiness endpoints for orchestrators |

---

## 4. Functional Requirements

### Authentication & Users

| ID     | Requirement                                                                                  | Priority |
| ------ | -------------------------------------------------------------------------------------------- | -------- |
| FR-001 | Users SHALL register with email/password or OAuth (Google, GitHub)                           | P0       |
| FR-002 | Users SHALL verify their email address before accessing the platform                         | P0       |
| FR-003 | Users SHALL log in via NextAuth.js session-based authentication on the dashboard             | P0       |
| FR-004 | Users SHALL authenticate to the gateway using API keys in the `Authorization: Bearer` header | P0       |
| FR-005 | The system SHALL hash API keys using SHA-256 before storage                                  | P0       |
| FR-006 | The system SHALL display the full API key exactly once at creation time                      | P0       |

### Organizations & Team Management

| ID     | Requirement                                                                | Priority |
| ------ | -------------------------------------------------------------------------- | -------- |
| FR-007 | Users SHALL create organizations to group API keys and team members        | P0       |
| FR-008 | Organization owners SHALL invite members via email                         | P1       |
| FR-009 | The system SHALL enforce RBAC with roles: `admin`, `org_owner`, `member`   | P0       |
| FR-010 | Organization owners SHALL configure spending limits (monthly cap in cents) | P1       |
| FR-011 | Organization owners SHALL set per-key rate limits (RPM, RPD overrides)     | P1       |

### API Key Management

| ID     | Requirement                                              | Priority |
| ------ | -------------------------------------------------------- | -------- |
| FR-012 | Users SHALL create API keys with a descriptive name      | P0       |
| FR-013 | Users SHALL revoke (soft-delete) API keys immediately    | P0       |
| FR-014 | Users SHALL optionally scope API keys to specific models | P2       |
| FR-015 | Users SHALL optionally set expiration dates on API keys  | P2       |
| FR-016 | The system SHALL track `last_used_at` for every API key  | P1       |

### AI Gateway — Request Proxying

| ID     | Requirement                                                                    | Priority |
| ------ | ------------------------------------------------------------------------------ | -------- |
| FR-017 | The gateway SHALL accept `POST /v1/chat/completions` requests in OpenAI format | P0       |
| FR-018 | The gateway SHALL resolve the requested model to the correct provider adapter  | P0       |
| FR-019 | The gateway SHALL transform requests to the provider's specific API format     | P0       |
| FR-020 | The gateway SHALL stream responses via SSE when `stream: true` is specified    | P0       |
| FR-021 | The gateway SHALL return non-streaming JSON responses when `stream: false`     | P0       |
| FR-022 | The gateway SHALL list available models via `GET /v1/models`                   | P0       |

### Usage & Cost Tracking

| ID     | Requirement                                                                      | Priority |
| ------ | -------------------------------------------------------------------------------- | -------- |
| FR-023 | The system SHALL count input and output tokens for every request                 | P0       |
| FR-024 | The system SHALL calculate the cost of each request based on model pricing       | P0       |
| FR-025 | The system SHALL log every request asynchronously (model, tokens, cost, latency) | P0       |
| FR-026 | The system SHALL aggregate usage into daily rollups per org/key/model            | P0       |
| FR-027 | The system SHALL block requests when an organization exceeds its spending limit  | P1       |

### Rate Limiting

| ID     | Requirement                                                                                                 | Priority |
| ------ | ----------------------------------------------------------------------------------------------------------- | -------- |
| FR-028 | The system SHALL enforce sliding-window rate limits using Redis                                             | P0       |
| FR-029 | The system SHALL return `429 Too Many Requests` with `Retry-After` header when limits are exceeded          | P0       |
| FR-030 | The system SHALL include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` in all responses | P1       |
| FR-031 | The system SHALL support rate limit overrides per API key                                                   | P1       |

### Provider Management

| ID     | Requirement                                                                                | Priority |
| ------ | ------------------------------------------------------------------------------------------ | -------- |
| FR-032 | Admins SHALL configure AI providers (name, URL, encrypted API key) via the admin dashboard | P0       |
| FR-033 | Admins SHALL manage the model catalog (add, update, deactivate models)                     | P0       |
| FR-034 | The system SHALL perform periodic health checks on configured providers                    | P1       |
| FR-035 | The system SHALL implement circuit breaker pattern for unhealthy providers                 | P1       |
| FR-036 | The system SHALL fall back to alternate providers when the primary is unavailable          | P2       |

### Observability & Audit

| ID     | Requirement                                                                                  | Priority |
| ------ | -------------------------------------------------------------------------------------------- | -------- |
| FR-037 | The system SHALL log all administrative actions to an immutable audit log                    | P1       |
| FR-038 | The system SHALL expose Prometheus metrics at `/metrics`                                     | P1       |
| FR-039 | The system SHALL send webhook notifications for configurable events                          | P2       |
| FR-040 | The system SHALL provide liveness (`/health/live`) and readiness (`/health/ready`) endpoints | P0       |

---

## 5. Non-Functional Requirements

| ID      | Category          | Requirement                                                       | Target                                              |
| ------- | ----------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| NFR-001 | **Performance**   | Gateway overhead (added latency excluding provider response time) | < 50ms p50, < 100ms p95, < 200ms p99                |
| NFR-002 | **Performance**   | Time to first byte for streaming responses                        | < 150ms after provider TTFB                         |
| NFR-003 | **Throughput**    | Concurrent request handling capacity                              | 10,000+ concurrent connections                      |
| NFR-004 | **Scalability**   | Gateway horizontal scaling                                        | Stateless pods behind load balancer                 |
| NFR-005 | **Scalability**   | Database connection management                                    | PgBouncer with configurable pool size               |
| NFR-006 | **Availability**  | Platform uptime SLA                                               | 99.9% (< 8.76 hours downtime/year)                  |
| NFR-007 | **Availability**  | Zero-downtime deployments                                         | Rolling updates in Kubernetes                       |
| NFR-008 | **Security**      | API key storage                                                   | SHA-256 hashed, never stored in plain text          |
| NFR-009 | **Security**      | Data encryption                                                   | TLS 1.3 in transit, AES-256 at rest for secrets     |
| NFR-010 | **Security**      | OWASP Top 10 compliance                                           | All categories addressed                            |
| NFR-011 | **Security**      | Dependency vulnerability scanning                                 | Automated in CI pipeline                            |
| NFR-012 | **Observability** | Structured logging format                                         | JSON with correlation IDs                           |
| NFR-013 | **Observability** | Metrics collection                                                | Prometheus-compatible `/metrics` endpoint           |
| NFR-014 | **Observability** | Error tracking                                                    | Sentry with environment/release tagging             |
| NFR-015 | **Data**          | Request log retention                                             | Configurable (default: 90 days, archive after)      |
| NFR-016 | **Data**          | Audit log retention                                               | Minimum 1 year, configurable                        |
| NFR-017 | **Compliance**    | GDPR readiness                                                    | Data export, deletion, and consent mechanisms       |
| NFR-018 | **Reliability**   | Database backups                                                  | Automated daily backups with point-in-time recovery |
| NFR-019 | **DevEx**         | API documentation                                                 | OpenAPI 3.1 spec with interactive Scalar docs       |
| NFR-020 | **DevEx**         | Local development setup                                           | Single `docker compose up` + `pnpm dev`             |

---

## 6. Success Metrics

### 6.1 Technical KPIs

| Metric                         | Target                   | Measurement             |
| ------------------------------ | ------------------------ | ----------------------- |
| Gateway Latency (p50)          | < 50ms overhead          | Prometheus histogram    |
| Gateway Latency (p95)          | < 100ms overhead         | Prometheus histogram    |
| Gateway Latency (p99)          | < 200ms overhead         | Prometheus histogram    |
| Error Rate (5xx)               | < 0.1% of total requests | Prometheus counter      |
| Platform Uptime                | > 99.9% monthly          | Health check monitoring |
| Time to First Byte (streaming) | < 150ms after provider   | Prometheus histogram    |
| Request Throughput             | > 1,000 RPS sustained    | k6 load test            |

### 6.2 Business KPIs

| Metric                          | Target (6 months) | Target (12 months) |
| ------------------------------- | ----------------- | ------------------ |
| Monthly Active Users (MAU)      | 500               | 2,000              |
| Monthly Active API Keys         | 1,000             | 5,000              |
| Daily API Requests              | 100,000           | 1,000,000          |
| Monthly Recurring Revenue (MRR) | $5,000            | $25,000            |
| Enterprise Accounts             | 3                 | 10                 |
| User Churn Rate                 | < 10% monthly     | < 5% monthly       |

### 6.3 Developer Experience KPIs

| Metric                     | Target                     | Measurement               |
| -------------------------- | -------------------------- | ------------------------- |
| Time to First API Call     | < 5 minutes                | User onboarding funnel    |
| API Documentation Coverage | 100% of endpoints          | OpenAPI spec completeness |
| SDK Availability           | TypeScript SDK v1.0        | Package published on npm  |
| Support Response Time      | < 4 hours (business hours) | Ticket tracking system    |

---

## 7. Scope (MVP / v1.0)

### Included in v1.0

| Area                | Deliverable                                                         |
| ------------------- | ------------------------------------------------------------------- |
| **Gateway**         | OpenAI-compatible `/v1/chat/completions` and `/v1/models` endpoints |
| **Streaming**       | Full SSE streaming support                                          |
| **Provider**        | 9Router integration (single provider)                               |
| **Auth**            | API key authentication (gateway), email/password auth (dashboard)   |
| **Key Management**  | Create, list, revoke API keys with SHA-256 hashing                  |
| **Organizations**   | Create org, invite members, RBAC (owner, admin, member)             |
| **Usage Tracking**  | Per-request logging, daily aggregation, cost calculation            |
| **Rate Limiting**   | Redis sliding-window rate limiting per key/org                      |
| **Spending Limits** | Per-organization monthly spending caps                              |
| **Dashboard**       | User dashboard (keys, usage charts, org settings)                   |
| **Admin Panel**     | Provider management, user management, system health                 |
| **Model Catalog**   | Browseable list of available models with pricing                    |
| **Observability**   | Structured logging, Prometheus metrics, health checks               |
| **Security**        | API key hashing, input validation, CORS, audit logs                 |
| **Deployment**      | Docker + Docker Compose, Kubernetes manifests                       |
| **Documentation**   | OpenAPI spec, interactive API docs (Scalar)                         |

### v1.0 Constraints

- Single AI provider (9Router) only
- No multi-region deployment
- No prompt caching or semantic caching
- No fine-tuned model hosting
- Basic webhook support (no complex event routing)

---

## 8. Out of Scope (Future Versions)

| Feature                         | Target Version | Notes                                           |
| ------------------------------- | -------------- | ----------------------------------------------- |
| **Multi-Provider Support**      | v1.1           | OpenAI, Anthropic, Google Gemini adapters       |
| **Prompt Caching**              | v1.2           | Semantic similarity caching to reduce costs     |
| **Advanced Analytics**          | v1.2           | ML-powered cost optimization recommendations    |
| **Custom Model Hosting**        | v2.0           | Host fine-tuned models on the platform          |
| **Model Marketplace**           | v2.0           | Community-shared fine-tuned models              |
| **Multi-Region Deployment**     | v2.0           | Edge routing to nearest region                  |
| **Mobile SDKs**                 | v2.0           | iOS (Swift) and Android (Kotlin) SDKs           |
| **Python & Go SDKs**            | v1.1           | Server-side SDK for popular languages           |
| **Prompt Management**           | v1.2           | Version-controlled prompt templates             |
| **A/B Testing**                 | v2.0           | Route percentage of traffic to different models |
| **SSO / SAML**                  | v1.2           | Enterprise single sign-on                       |
| **SLA Dashboard**               | v1.2           | Public status page with uptime metrics          |
| **Embeddings API**              | v1.1           | `/v1/embeddings` endpoint                       |
| **Image Generation**            | v2.0           | `/v1/images/generations` endpoint               |
| **Batch API**                   | v1.2           | Async batch request processing                  |
| **Cost Alerts via Email/Slack** | v1.1           | Push notifications for spending thresholds      |

---

## Appendix A: Glossary

| Term                | Definition                                                    |
| ------------------- | ------------------------------------------------------------- |
| **Gateway**         | The core API proxy that routes requests to AI providers       |
| **Provider**        | An external AI service (e.g., 9Router, OpenAI)                |
| **Model**           | A specific AI language model (e.g., `llama-3.1-70b`)          |
| **API Key**         | A secret credential used to authenticate gateway requests     |
| **Organization**    | A billing entity that owns API keys and team members          |
| **RPM**             | Requests Per Minute (rate limit unit)                         |
| **RPD**             | Requests Per Day (rate limit unit)                            |
| **SSE**             | Server-Sent Events — protocol for streaming responses         |
| **TTFB**            | Time To First Byte — latency before first response chunk      |
| **Circuit Breaker** | Pattern to prevent cascading failures from unhealthy services |

## Appendix B: Reference Platforms

| Platform   | URL                   | Relevance                                |
| ---------- | --------------------- | ---------------------------------------- |
| OpenRouter | https://openrouter.ai | Primary inspiration — unified AI gateway |
| LiteLLM    | https://litellm.ai    | OSS proxy with provider abstraction      |
| Portkey    | https://portkey.ai    | AI gateway with observability features   |
| Helicone   | https://helicone.ai   | AI observability and logging platform    |
