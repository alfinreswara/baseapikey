-- The usage event of a request needs a key that is stable over the retries of
-- the delivery queue. The request id of the HTTP layer is only unique inside
-- a process, so it can not identify a usage event.
--
-- The unique constraint makes the recording of a usage event idempotent: a
-- retry of the same event does not create a second usage row and does not
-- charge the credit balance a second time, because the charge uses the id of
-- the usage row as its idempotency key.
--
-- The change is additive. The existing rows receive a random key, they are
-- not linked to a request and keep their current accounting.
ALTER TABLE "usages" ADD COLUMN "usage_key" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "usages_api_key_id_usage_key_key"
ON "usages"("api_key_id", "usage_key");
