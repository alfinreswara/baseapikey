-- The credit of an organization is reserved before a request is forwarded to a
-- provider and settled when the real usage is known.
--
-- The reservation table is the source of truth for the held credit. The
-- `reserved_micros` column of the billing account is the denormalized sum of
-- the open reservations, it is only used for the atomic conditional update
-- that protects the balance.
--
-- The money unit of the reservation is the micro dollar, the same unit as the
-- unbilled usage accumulator. One cent are ten thousand micros.
CREATE TABLE "billing_reservations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "billing_account_id" UUID NOT NULL,
  "api_key_id" UUID,
  "request_id" VARCHAR(255) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "modality" VARCHAR(32) NOT NULL,
  "amount_micros" BIGINT NOT NULL,
  "settled_amount_micros" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_reservations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_reservations_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_reservations_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- The idempotency key of a request identifies its reservation. A retry of the
-- request or of the settlement never creates a second reservation.
CREATE UNIQUE INDEX "billing_reservations_idempotency_key_key"
ON "billing_reservations"("idempotency_key");

-- The recovery of the reservations looks for the open ones that expired.
CREATE INDEX "billing_reservations_status_expires_at_idx"
ON "billing_reservations"("status", "expires_at");

-- The held credit of the open reservations.
ALTER TABLE "billing_accounts"
ADD COLUMN "reserved_micros" BIGINT NOT NULL DEFAULT 0;

-- The exact cost of a ledger entry in micros. The limit of the spending is
-- checked against the settled cost plus the held credit, so the two are never
-- counted twice.
ALTER TABLE "credit_transactions"
ADD COLUMN "cost_micros" INTEGER NOT NULL DEFAULT 0;

-- The existing entries carry their cost in the metadata.
UPDATE "credit_transactions"
SET "cost_micros" = (metadata ->> 'costMicros')::INTEGER
WHERE metadata ? 'costMicros' AND (metadata ->> 'costMicros') ~ '^[0-9]+$';

-- The prices of the modalities that are not billed per token. A null value
-- means that the modality has no verifiable price and the request is rejected
-- before the provider is called.
ALTER TABLE "ai_models"
ADD COLUMN "price_per_image" DECIMAL(12,6),
ADD COLUMN "price_per_character" DECIMAL(12,6),
ADD COLUMN "price_per_megabyte" DECIMAL(12,6);
