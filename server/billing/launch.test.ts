import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { quotaInTransaction, releaseInTransaction } from "./quota";
import {
  paidEntitlement,
  syncCustomerInTransaction,
  validatePrice,
  billingOrigin,
  isPricingEnabled,
  createCheckoutSession,
} from "./stripe";
import { PLANS } from "./products";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
let db: PGlite;
const migration = readFileSync(
  new URL("../../drizzle/migrations/0014_billing_launch.sql", import.meta.url),
  "utf8"
);
const dialect = new PgDialect();
const adapter = (tx: any) => ({
  execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    return (await tx.query(q.sql, q.params)).rows;
  },
});
const run = (fn: any) => db.transaction(tx => fn(adapter(tx)));
const quota = (reserve = false, userId = 1) =>
  run((tx: any) => quotaInTransaction(tx, userId, reserve));
function price(plan: "pro" | "team" | "enterprise" = "pro") {
  return {
    id: `price_${plan}`,
    active: true,
    currency: "usd",
    unit_amount: PLANS[plan].priceMonthly,
    billing_scheme: "per_unit",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  } as any;
}
function subscription(overrides: any = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "sub_a",
    status: "active",
    current_period_start: now - 3600,
    current_period_end: now + 86400,
    cancel_at_period_end: false,
    latest_invoice: { status: "paid" },
    items: { data: [{ price: price(), quantity: 1 }] },
    ...overrides,
  } as any;
}
const sync = (subs: any[]) =>
  run((tx: any) =>
    syncCustomerInTransaction(tx, "cus_a", {
      subscriptions: { list: async () => ({ data: subs, has_more: false }) },
    } as any)
  );
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `CREATE TABLE users(id integer PRIMARY KEY, email text, "stripeCustomerId" text, "documentQuotaUsed" integer DEFAULT 0, plan text DEFAULT 'free'); CREATE TABLE projects(id integer PRIMARY KEY, "userId" integer); CREATE TABLE documents(id integer PRIMARY KEY, "projectId" integer);`
  );
  await db.exec(migration);
  state.db = { transaction: run };
});
afterAll(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  vi.stubEnv("STRIPE_PRICE_PRO", "price_pro");
  vi.stubEnv("STRIPE_PRICE_TEAM", "price_team");
  vi.stubEnv("STRIPE_PRICE_ARCHIVE", "price_enterprise");
  vi.stubEnv("TURATH_PRICING_ENABLED", "true");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_dummy");
  vi.stubEnv("STRIPE_PORTAL_CONFIGURATION", "bpc_test");
  await db.exec(
    `TRUNCATE users CASCADE; INSERT INTO users(id,email,"stripeCustomerId") VALUES(1,'reader@example.com','cus_a'),(2,' ADAMAMIN2027@GMAIL.COM ',NULL);`
  );
});
describe("billing launch", () => {
  it("does not reset usage for an unpaid renewal or ambiguous multiple subscriptions", async () => {
    const first = subscription();
    await sync([first]);
    await quota(true);
    await sync([
      {
        ...first,
        current_period_start: first.current_period_start + 100,
        latest_invoice: { status: "open" },
        status: "past_due",
      },
    ]);
    expect((await quota()).documentsUsed).toBe(1);
    await expect(
      sync([first, { ...first, id: "sub_duplicate" }])
    ).rejects.toThrow("Multiple paid subscriptions");
    expect((await quota()).documentsUsed).toBe(1);
  });
  it("retries early webhook delivery until a TURATH customer binding exists", async () => {
    const provider = {
      customers: {
        retrieve: async () => ({
          deleted: false,
          metadata: { turath_user_id: "1" },
        }),
      },
    } as any;
    await expect(
      run((tx: any) =>
        syncCustomerInTransaction(tx, "cus_not_committed", provider)
      )
    ).rejects.toThrow("not committed");
    const unrelated = {
      customers: { retrieve: async () => ({ deleted: false, metadata: {} }) },
    } as any;
    await expect(
      run((tx: any) =>
        syncCustomerInTransaction(tx, "cus_unrelated", unrelated)
      )
    ).resolves.toBeUndefined();
  });
  it("enforces 20 lifetime free uploads including ten simultaneous reservations", async () => {
    await db.exec(`UPDATE users SET "documentQuotaUsed"=15 WHERE id=1`);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => quota(true))
    );
    expect(results.filter(result => result.quotaReserved)).toHaveLength(5);
    expect((await quota()).documentsRemaining).toBe(0);
  });
  it("enforces each paid plan's exact allowance", async () => {
    for (const plan of ["pro", "team", "enterprise"] as const) {
      await sync([
        subscription({
          items: { data: [{ price: price(plan), quantity: 1 }] },
        }),
      ]);
      const result = await quota();
      expect(result.documentLimit).toBe(PLANS[plan].documentLimit);
      const account = (
        await db.query<any>("SELECT period_key FROM billing_accounts")
      ).rows[0];
      await db.query(
        "INSERT INTO billing_usage(user_id,period_key,used) VALUES(1,$1,$2) ON CONFLICT(user_id,period_key) DO UPDATE SET used=excluded.used",
        [account.period_key, PLANS[plan].documentLimit - 1]
      );
      const last = await Promise.all(
        Array.from({ length: 10 }, () => quota(true))
      );
      expect(last.filter(result => result.quotaReserved)).toHaveLength(1);
    }
  });
  it("keeps Adam unlimited without consuming reservations", async () => {
    expect(await quota(true, 2)).toMatchObject({
      plan: "owner",
      documentLimit: null,
      quotaReserved: false,
      allowed: true,
    });
  });
  it("resets only on a new paid period and duplicate delivery never resets usage", async () => {
    const first = subscription();
    await sync([first]);
    await quota(true);
    await sync([first]);
    expect((await quota()).documentsUsed).toBe(1);
    const next = subscription({
      current_period_start: first.current_period_start + 100,
    });
    await sync([next]);
    expect((await quota()).documentsUsed).toBe(0);
    await quota(true);
    await sync([next]);
    expect((await quota()).documentsUsed).toBe(1);
  });
  it("reconciles a paid renewal against Stripe test-clock time", async () => {
    const futureStart = Math.floor(Date.now() / 1000) + 2_592_000;
    const futureEnd = futureStart + 2_592_000;
    const future = subscription({
      test_clock: "clock_test",
      current_period_start: futureStart,
      current_period_end: futureEnd,
    });
    await run((tx: any) =>
      syncCustomerInTransaction(tx, "cus_a", {
        subscriptions: {
          list: async () => ({ data: [future], has_more: false }),
        },
        testHelpers: {
          testClocks: {
            retrieve: async () => ({ frozen_time: futureStart + 60 }),
          },
        },
      } as any)
    );
    const account = (
      await db.query<any>(
        "SELECT plan,period_key,period_start,period_end FROM billing_accounts WHERE user_id=1"
      )
    ).rows[0];
    expect(account.plan).toBe("pro");
    expect(account.period_key).toBe(`sub_a:${futureStart}`);
  });
  it("does not grant capacity for unpaid, unknown-price or invalid subscriptions", async () => {
    expect(
      paidEntitlement(subscription({ latest_invoice: { status: "open" } }))
    ).toBeNull();
    expect(paidEntitlement(subscription({ status: "incomplete" }))).toBeNull();
    expect(
      paidEntitlement(
        subscription({
          items: {
            data: [{ price: { ...price(), id: "price_other" }, quantity: 1 }],
          },
        })
      )
    ).toBeNull();
    expect(paidEntitlement(subscription({ current_period_end: 1 }))).toBeNull();
    expect(
      paidEntitlement(
        subscription({ items: { data: [{ price: price(), quantity: 2 }] } })
      )
    ).toBeNull();
  });
  it("retains usage on same-period upgrades and prevents new slots on downgrade", async () => {
    const sub = subscription();
    await sync([sub]);
    await quota(true);
    await sync([
      { ...sub, items: { data: [{ price: price("team"), quantity: 1 }] } },
    ]);
    expect(await quota()).toMatchObject({
      plan: "team",
      documentsUsed: 1,
      documentsRemaining: 299,
    });
    await db.exec("UPDATE billing_usage SET used=150");
    await sync([sub]);
    expect(await quota()).toMatchObject({
      plan: "pro",
      documentsUsed: 150,
      allowed: false,
    });
  });
  it("preserves free lifetime usage across paid months and cancellation", async () => {
    await db.exec(`UPDATE users SET "documentQuotaUsed"=20 WHERE id=1`);
    const sub = subscription({ cancel_at_period_end: true });
    await sync([sub]);
    await quota(true);
    expect(await quota()).toMatchObject({
      plan: "pro",
      cancelAtPeriodEnd: true,
    });
    await sync([{ ...sub, status: "canceled" }]);
    expect(await quota()).toMatchObject({
      plan: "free",
      documentsUsed: 20,
      allowed: false,
    });
  });
  it("expires paid capacity locally even when a renewal webhook is missing", async () => {
    await sync([subscription()]);
    await db.exec(
      "UPDATE billing_accounts SET period_end=now()-interval '1 second'"
    );
    expect((await quota()).plan).toBe("free");
  });
  it("releases only the failed upload's original period, exactly once", async () => {
    const first = subscription();
    await sync([first]);
    const reservation = await quota(true);
    await sync([
      subscription({ current_period_start: first.current_period_start + 100 }),
    ]);
    await quota(true);
    await run((tx: any) =>
      releaseInTransaction(tx, 1, reservation.reservationId)
    );
    await run((tx: any) =>
      releaseInTransaction(tx, 1, reservation.reservationId)
    );
    expect((await quota()).documentsUsed).toBe(1);
    expect(
      (await db.query<any>("SELECT sum(used) AS total FROM billing_usage"))
        .rows[0].total
    ).toBe(1);
  });
  it("rejects the wrong price amount, currency, or billing interval", () => {
    expect(() =>
      validatePrice({ ...price(), unit_amount: 999 }, "pro")
    ).toThrow();
    expect(() =>
      validatePrice({ ...price(), currency: "eur" }, "pro")
    ).toThrow();
    expect(() =>
      validatePrice(
        {
          ...price(),
          recurring: {
            interval: "year",
            interval_count: 1,
            usage_type: "licensed",
          },
        },
        "pro"
      )
    ).toThrow();
    expect(() => validatePrice(price(), "pro")).not.toThrow();
  });
  it("requires all launch settings and prevents arbitrary redirect origins", () => {
    expect(isPricingEnabled()).toBe(true);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(isPricingEnabled()).toBe(false);
    vi.stubEnv("TURATH_APP_URL", "https://turath.app");
    expect(billingOrigin()).toBe("https://turath.app");
    vi.stubEnv("TURATH_APP_URL", "http://evil.example");
    expect(() => billingOrigin()).toThrow();
    vi.stubEnv("TURATH_APP_URL", "");
  });
  it("a repeat migration preserves free counters after paid uploads", async () => {
    await sync([subscription()]);
    await quota(true);
    await db.exec(
      "INSERT INTO projects VALUES(1,1); INSERT INTO documents VALUES(1,1)"
    );
    await db.exec(migration);
    expect(
      (await db.query<any>('SELECT "documentQuotaUsed" FROM users WHERE id=1'))
        .rows[0].documentQuotaUsed
    ).toBe(0);
  });

  it("serializes duplicate checkout clicks and reuses the same open session", async () => {
    const create = vi.fn(async () => ({
      id: "cs_one",
      url: "https://checkout.stripe.com/test-one",
    }));
    const stripe = {
      prices: { retrieve: async () => price() },
      subscriptions: { list: async () => ({ data: [], has_more: false }) },
      checkout: {
        sessions: {
          create,
          retrieve: async () => ({
            status: "open",
            url: "https://checkout.stripe.com/test-one",
            line_items: { data: [{ price: { id: "price_pro" }, quantity: 1 }] },
          }),
        },
      },
    } as any;
    const options = {
      userId: 1,
      userEmail: "reader@example.com",
      userName: "Reader",
      planId: "pro" as const,
      origin: "https://attacker.example",
    };
    const urls = await Promise.all([
      createCheckoutSession(options, stripe),
      createCheckoutSession(options, stripe),
    ]);
    expect(urls).toEqual([
      "https://checkout.stripe.com/test-one",
      "https://checkout.stripe.com/test-one",
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      customer: "cus_a",
      success_url: "https://turath.app/settings/billing?success=true",
      line_items: [{ price: "price_pro", quantity: 1 }],
    });
  });
  it("prevents a second subscription and refuses owner checkout", async () => {
    const create = vi.fn();
    const stripe = {
      prices: { retrieve: async () => price() },
      subscriptions: {
        list: async () => ({ data: [subscription()], has_more: false }),
      },
      checkout: { sessions: { create } },
    } as any;
    const options = {
      userId: 1,
      userEmail: "reader@example.com",
      userName: "Reader",
      planId: "pro" as const,
    };
    await expect(createCheckoutSession(options, stripe)).rejects.toThrow(
      "already have"
    );
    await expect(
      createCheckoutSession({ ...options, userId: 2 }, stripe)
    ).rejects.toThrow("does not need");
    expect(create).not.toHaveBeenCalled();
  });
});
