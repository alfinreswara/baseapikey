ALTER TABLE "billing_accounts"
ADD COLUMN "unbilled_usage_micros" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "billing_accounts_organization_id_status_idx"
ON "billing_accounts"("organization_id", "status");
