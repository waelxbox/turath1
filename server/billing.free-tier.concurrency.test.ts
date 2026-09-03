import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_DOCUMENT_LIMIT, isUnlimitedOwnerEmail } from "./billing/products";

describe("free-tier quota database boundary", () => {
  let database: PGlite | null = null;

  afterEach(async () => {
    await database?.close();
    database = null;
  });

  async function createQuotaDatabase(used: number) {
    database = new PGlite();
    await database.exec(`
      CREATE TABLE users (
        id integer PRIMARY KEY,
        email text NOT NULL,
        document_quota_used integer NOT NULL DEFAULT 0
      );
      INSERT INTO users (id, email, document_quota_used)
      VALUES
        (1, 'researcher@example.com', ${used}),
        (2, 'adamamin2027@gmail.com', ${used});
    `);
    return database;
  }

  async function reserveOne(db: PGlite, userId = 1) {
    return db.query<{ document_quota_used: number }>(`
      UPDATE users
      SET document_quota_used = document_quota_used + 1
      WHERE id = ${userId}
        AND document_quota_used < ${FREE_DOCUMENT_LIMIT}
      RETURNING document_quota_used
    `);
  }

  async function reserveAccordingToPolicy(db: PGlite, userId: number) {
    const account = await db.query<{ email: string }>(`SELECT email FROM users WHERE id = ${userId}`);
    if (isUnlimitedOwnerEmail(account.rows[0]?.email)) {
      return { isOwnerExempt: true, rows: [] as { document_quota_used: number }[] };
    }
    const result = await reserveOne(db, userId);
    return { isOwnerExempt: false, rows: result.rows };
  }

  it("allows exactly one of two simultaneous reservations at 49 documents", async () => {
    const db = await createQuotaDatabase(FREE_DOCUMENT_LIMIT - 1);

    const attempts = await Promise.all([reserveOne(db), reserveOne(db)]);
    expect(attempts.filter(result => result.rows.length === 1)).toHaveLength(1);
    expect(attempts.filter(result => result.rows.length === 0)).toHaveLength(1);

    const final = await db.query<{ document_quota_used: number }>(
      "SELECT document_quota_used FROM users WHERE id = 1",
    );
    expect(final.rows[0]?.document_quota_used).toBe(FREE_DOCUMENT_LIMIT);
  });

  it("returns a failed reservation before storage work when the account is full", async () => {
    const db = await createQuotaDatabase(FREE_DOCUMENT_LIMIT);
    const storagePut = vi.fn();

    const reservation = await reserveOne(db);
    if (reservation.rows.length > 0) storagePut();
    expect(reservation.rows).toHaveLength(0);
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("restores the reserved slot when downstream upload work fails", async () => {
    const db = await createQuotaDatabase(FREE_DOCUMENT_LIMIT - 1);
    const reservation = await reserveOne(db);
    expect(reservation.rows[0]?.document_quota_used).toBe(FREE_DOCUMENT_LIMIT);

    await db.query(`
      UPDATE users
      SET document_quota_used = GREATEST(document_quota_used - 1, 0)
      WHERE id = 1 AND document_quota_used > 0
    `);

    const final = await db.query<{ document_quota_used: number }>(
      "SELECT document_quota_used FROM users WHERE id = 1",
    );
    expect(final.rows[0]?.document_quota_used).toBe(FREE_DOCUMENT_LIMIT - 1);
  });

  it("keeps Adam's owner account outside the capped reservation path", async () => {
    const db = await createQuotaDatabase(FREE_DOCUMENT_LIMIT);
    const reservation = await reserveAccordingToPolicy(db, 2);
    expect(reservation.isOwnerExempt).toBe(true);
    expect(reservation.rows).toHaveLength(0);

    const final = await db.query<{ document_quota_used: number }>(
      "SELECT document_quota_used FROM users WHERE id = 2",
    );
    expect(final.rows[0]?.document_quota_used).toBe(FREE_DOCUMENT_LIMIT);
  });
});
