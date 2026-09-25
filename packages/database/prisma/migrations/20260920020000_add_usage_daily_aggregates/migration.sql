CREATE TABLE "usage_daily_aggregates" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "provider" VARCHAR(100) NOT NULL,
  "model" VARCHAR(100) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "successful_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
  "completion_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost" DECIMAL(14,8) NOT NULL DEFAULT 0,
  "latency_total_ms" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "usage_daily_aggregates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_daily_aggregates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "usage_daily_aggregates_org_date_provider_model_key"
ON "usage_daily_aggregates"("organization_id", "date", "provider", "model");
CREATE INDEX "usage_daily_aggregates_organization_id_date_idx"
ON "usage_daily_aggregates"("organization_id", "date");
