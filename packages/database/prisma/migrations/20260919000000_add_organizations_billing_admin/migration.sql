-- CreateEnum
CREATE TYPE "organization_role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "organization_plan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');
CREATE TYPE "organization_member_status" AS ENUM ('INVITED', 'ACTIVE');
CREATE TYPE "provider_health_status" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'DOWN');
CREATE TYPE "billing_account_status" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "billing_invoice_status" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');
CREATE TYPE "credit_transaction_type" AS ENUM ('PURCHASE', 'USAGE', 'ADJUSTMENT', 'REFUND');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "owner_id" UUID NOT NULL,
    "billing_email" VARCHAR(255),
    "plan" "organization_plan" NOT NULL DEFAULT 'FREE',
    "spending_limit_cents" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "organization_role" NOT NULL DEFAULT 'MEMBER',
    "status" "organization_member_status" NOT NULL DEFAULT 'ACTIVE',
    "invited_by_id" UUID,
    "joined_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_organization_preferences" (
    "user_id" UUID NOT NULL,
    "active_organization_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "user_organization_preferences_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "billing_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "billing_account_status" NOT NULL DEFAULT 'ACTIVE',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "credit_balance_cents" INTEGER NOT NULL DEFAULT 0,
    "external_customer_id" VARCHAR(255),
    "current_period_start" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_invoices" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "external_invoice_id" VARCHAR(255),
    "status" "billing_invoice_status" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "invoice_url" TEXT,
    "period_start" TIMESTAMPTZ NOT NULL,
    "period_end" TIMESTAMPTZ NOT NULL,
    "due_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_transactions" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "type" "credit_transaction_type" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "balance_after_cents" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "provider_event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- AlterTable (nullable organization references preserve existing historical records)
ALTER TABLE "api_keys" ADD COLUMN "organization_id" UUID;
ALTER TABLE "usages" ADD COLUMN "organization_id" UUID;
ALTER TABLE "audit_logs" ADD COLUMN "organization_id" UUID;
ALTER TABLE "providers" ADD COLUMN "health_status" "provider_health_status" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "providers" ADD COLUMN "health_checked_at" TIMESTAMPTZ;

-- Backfill a personal organization and active context for existing users.
INSERT INTO "organizations" ("id", "name", "slug", "owner_id", "billing_email", "created_at", "updated_at")
SELECT gen_random_uuid(), left("full_name", 230) || '''s Organization', 'personal-' || replace("id"::text, '-', ''), "id", "email", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users"
WHERE "deleted_at" IS NULL;

INSERT INTO "organization_members" ("id", "organization_id", "user_id", "role", "status", "joined_at", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", "owner_id", 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations";

INSERT INTO "user_organization_preferences" ("user_id", "active_organization_id", "updated_at")
SELECT "owner_id", "id", CURRENT_TIMESTAMP FROM "organizations";

INSERT INTO "billing_accounts" ("id", "organization_id", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "organizations";

UPDATE "api_keys" AS api_key
SET "organization_id" = organization."id"
FROM "organizations" AS organization
WHERE organization."owner_id" = api_key."user_id" AND api_key."organization_id" IS NULL;

UPDATE "usages" AS usage
SET "organization_id" = organization."id"
FROM "organizations" AS organization
WHERE organization."owner_id" = usage."user_id" AND usage."organization_id" IS NULL;

UPDATE "audit_logs" AS audit
SET "organization_id" = organization."id"
FROM "organizations" AS organization
WHERE organization."owner_id" = audit."user_id" AND audit."organization_id" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_owner_id_idx" ON "organizations"("owner_id");
CREATE INDEX "organizations_is_active_deleted_at_idx" ON "organizations"("is_active", "deleted_at");
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");
CREATE INDEX "organization_members_user_id_status_idx" ON "organization_members"("user_id", "status");
CREATE INDEX "organization_members_organization_id_role_status_idx" ON "organization_members"("organization_id", "role", "status");
CREATE INDEX "user_organization_preferences_active_organization_id_idx" ON "user_organization_preferences"("active_organization_id");
CREATE INDEX "api_keys_organization_id_status_created_at_idx" ON "api_keys"("organization_id", "status", "created_at");
CREATE INDEX "usages_organization_id_created_at_idx" ON "usages"("organization_id", "created_at");
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");
CREATE UNIQUE INDEX "billing_accounts_organization_id_key" ON "billing_accounts"("organization_id");
CREATE UNIQUE INDEX "billing_accounts_external_customer_id_key" ON "billing_accounts"("external_customer_id");
CREATE INDEX "billing_accounts_status_idx" ON "billing_accounts"("status");
CREATE UNIQUE INDEX "billing_invoices_external_invoice_id_key" ON "billing_invoices"("external_invoice_id");
CREATE INDEX "billing_invoices_billing_account_id_created_at_idx" ON "billing_invoices"("billing_account_id", "created_at");
CREATE INDEX "billing_invoices_status_due_at_idx" ON "billing_invoices"("status", "due_at");
CREATE UNIQUE INDEX "credit_transactions_idempotency_key_key" ON "credit_transactions"("idempotency_key");
CREATE INDEX "credit_transactions_billing_account_id_created_at_idx" ON "credit_transactions"("billing_account_id", "created_at");
CREATE INDEX "credit_transactions_type_created_at_idx" ON "credit_transactions"("type", "created_at");
CREATE UNIQUE INDEX "billing_webhook_events_provider_provider_event_id_key" ON "billing_webhook_events"("provider", "provider_event_id");
CREATE INDEX "billing_webhook_events_processed_at_created_at_idx" ON "billing_webhook_events"("processed_at", "created_at");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_organization_preferences" ADD CONSTRAINT "user_organization_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_organization_preferences" ADD CONSTRAINT "user_organization_preferences_active_organization_id_fkey" FOREIGN KEY ("active_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "usages" ADD CONSTRAINT "usages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
