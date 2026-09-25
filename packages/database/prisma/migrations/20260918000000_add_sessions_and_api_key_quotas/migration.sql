-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "device_id" VARCHAR(255),
    "device_name" VARCHAR(255),
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_quotas" (
    "id" UUID NOT NULL,
    "api_key_id" UUID NOT NULL,
    "requests_per_minute" INTEGER NOT NULL DEFAULT 60,
    "requests_per_day" INTEGER NOT NULL DEFAULT 10000,
    "tokens_per_day" INTEGER NOT NULL DEFAULT 5000000,
    "monthly_budget_usd" DECIMAL(12,4) NOT NULL DEFAULT 100.00,
    "current_requests_minute" INTEGER NOT NULL DEFAULT 0,
    "current_requests_day" INTEGER NOT NULL DEFAULT 0,
    "current_tokens_day" INTEGER NOT NULL DEFAULT 0,
    "current_spend_usd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "reset_minute_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reset_day_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reset_month_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "api_key_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_refresh_token_hash_idx" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_quotas_api_key_id_key" ON "api_key_quotas"("api_key_id");

-- CreateIndex
CREATE INDEX "api_key_quotas_api_key_id_idx" ON "api_key_quotas"("api_key_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_quotas" ADD CONSTRAINT "api_key_quotas_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
