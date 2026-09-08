-- Apply before deploying billing launch. No payment-provider mutations.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_unique ON users("stripeCustomerId") WHERE "stripeCustomerId" IS NOT NULL;
CREATE TABLE IF NOT EXISTS billing_accounts (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  subscription_id text,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','team','enterprise')),
  period_start timestamptz,
  period_end timestamptz,
  period_key text,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  subscription_status text,
  checkout_id text,
  checkout_plan text,
  synced_at timestamptz
);
CREATE TABLE IF NOT EXISTS billing_usage (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (user_id, period_key)
);
CREATE TABLE IF NOT EXISTS billing_reservations (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key text,
  released boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_reservations_user_idx ON billing_reservations(user_id);
-- Preserve historical free usage; paid usage begins in separate period buckets.
UPDATE users u SET "documentQuotaUsed" = GREATEST(u."documentQuotaUsed", (
  SELECT count(*)::integer FROM documents d JOIN projects p ON p.id = d."projectId" WHERE p."userId" = u.id
)) WHERE NOT EXISTS (SELECT 1 FROM billing_accounts a WHERE a.user_id=u.id);
INSERT INTO billing_accounts(user_id) SELECT id FROM users ON CONFLICT DO NOTHING;
ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_reservations ENABLE ROW LEVEL SECURITY;
COMMIT;
