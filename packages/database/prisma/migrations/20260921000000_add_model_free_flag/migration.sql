-- A model is only served when the catalogue carries a trusted price. A model
-- without a price can be marked as explicitly free by an administrator, every
-- other model without a price is rejected instead of being metered as free.
--
-- The default is false, so an existing model with a price keeps working and
-- an existing model without a price starts to be rejected until an
-- administrator prices it or marks it as free. The change is additive and
-- needs no data migration.
ALTER TABLE "ai_models" ADD COLUMN "is_free" BOOLEAN NOT NULL DEFAULT false;
