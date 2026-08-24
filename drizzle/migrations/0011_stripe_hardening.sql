DO $$ BEGIN
  CREATE TYPE "public"."subscription_status" AS ENUM ('active', 'canceled', 'past_due', 'trialing');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripeSubscriptionStatus" "subscription_status";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastStripeEventCreatedAt" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingStripeCheckoutLockId" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingStripeCheckoutSessionId" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingStripeCheckoutExpiresAt" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "transcriptionQuotaUsed" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "quotaPeriodStartedAt" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "demoProjectCreatedAt" timestamp;

UPDATE "users" AS u SET "documentQuotaUsed" = GREATEST(
  u."documentQuotaUsed",
  (SELECT count(*)::integer FROM "documents" d JOIN "projects" p ON p."id" = d."projectId" WHERE p."userId" = u."id")
);
UPDATE "users" AS u SET "transcriptionQuotaUsed" = GREATEST(
  u."transcriptionQuotaUsed",
  (SELECT count(*)::integer FROM "transcriptions" t JOIN "projects" p ON p."id" = t."projectId" WHERE p."userId" = u."id")
);
UPDATE "users" AS u SET "demoProjectCreatedAt" = (
  SELECT min(p."createdAt") FROM "projects" p
  WHERE p."userId" = u."id" AND p."name" ILIKE '%demo%'
) WHERE u."demoProjectCreatedAt" IS NULL AND EXISTS (
  SELECT 1 FROM "projects" p WHERE p."userId" = u."id" AND p."name" ILIKE '%demo%'
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_stripeCustomerId_unique" ON "users" ("stripeCustomerId") WHERE "stripeCustomerId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "users_stripeSubscriptionId_unique" ON "users" ("stripeSubscriptionId") WHERE "stripeSubscriptionId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "transcriptions_documentId_unique" ON "transcriptions" ("documentId");

CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "eventId" varchar(255) PRIMARY KEY,
  "eventType" varchar(255) NOT NULL,
  "stripeCreatedAt" integer NOT NULL,
  "processedAt" timestamp DEFAULT now() NOT NULL
);
