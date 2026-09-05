import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { estimateCost, isPlatformOwner } from "../../shared/admin";
import type { TrpcContext } from "../_core/context";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: vi.fn(async () => state.db) }));
import { getDb } from "../db";
import { adminRouter } from "./router";

function caller(email: string | null, role = "user") {
  const setHeader = vi.fn();
  return {
    api: adminRouter.createCaller({
      user: email === null ? null : { id: 1, email, role },
      req: {},
      res: { setHeader },
    } as unknown as TrpcContext),
    setHeader,
  };
}
let database: PGlite;
beforeAll(async () => {
  database = new PGlite();
  // Match postgres-js's array result shape while executing the production SQL
  // against real PostgreSQL in PGlite (its native API returns { rows }).
  const dialect = new PgDialect();
  state.db = {
    transaction: (fn: any) =>
      database.transaction(async tx =>
        fn({
          execute: async (query: any) => {
            const compiled = dialect.sqlToQuery(query);
            return (await tx.query(compiled.sql, compiled.params)).rows;
          },
        })
      ),
  };
  await database.exec(`
    create table users (id int primary key, name text, email text, plan text default 'free', "createdAt" timestamp default now(), "lastSignedIn" timestamp default now(), "documentQuotaUsed" int default 0, "openId" text default 'SECRET');
    create table projects (id int primary key, "userId" int, name text, status text default 'active', "createdAt" timestamp default now(), "updatedAt" timestamp default now());
    create table documents (id int, "projectId" int, status text, "fileSizeBytes" int, "uploadedAt" timestamp default now());
    create table transcriptions (id int, "projectId" int);
    create table visual_assets (id int, "projectId" int, status text, "byteSize" int, "createdAt" timestamp default now());
    create table vra_records (id int, "projectId" int, status text);
    create table jobs (id int, "projectId" int, status text);
    create table project_members ("projectId" int, "userId" int, role text);
    create table research_conversations (id int, "projectId" int);
    create table visual_project_modes ("projectId" int, "archiveMode" text);
    insert into users (id,name,email,"documentQuotaUsed") values
      (1,'Adam','adamamin2027@gmail.com',99), (2,'Researcher','reader@example.com',20),
      (3,'Collaborator','member@example.com',0), (4,'New signup',null,0), (5,'Literal % person','literal@example.com',0);
    insert into projects (id,"userId",name) values (10,2,'Cairo'), (11,2,'Visual Egypt'), (12,3,'Personal collection');
    insert into visual_project_modes values (11,'visual_vra');
    insert into documents values (1,10,'reviewed',1000,now()), (2,10,'needs_review',2000,now()), (3,10,'error',null,now()), (4,12,'processing',4000,now());
    insert into transcriptions values (1,10),(2,10),(3,12);
    insert into visual_assets values (1,11,'ready',5000,now()),(2,11,'failed',6000,now());
    insert into vra_records values (1,11,'approved'),(2,11,'needs_review'),(3,11,'draft');
    insert into jobs values (1,10,'queued'),(2,10,'running'),(3,11,'failed');
    insert into project_members values (10,2,'owner'),(10,3,'viewer'),(10,3,'editor'),(11,3,'viewer');
    insert into research_conversations values (1,10),(2,10);
  `);
}, 30000);
afterAll(async () => {
  await database?.close();
});

describe("owner administration authorization", () => {
  it.each([
    null,
    "reader@example.com",
    "adamamin2027@gmail.com.evil",
    "adamamin2027+alias@gmail.com",
  ])(
    "denies every data endpoint for %s before querying the DB",
    async email => {
      const { api } = caller(email, "admin");
      vi.mocked(getDb).mockClear();
      const code = email === null ? "UNAUTHORIZED" : "FORBIDDEN";
      await expect(api.overview()).rejects.toMatchObject({ code });
      await expect(api.users({})).rejects.toMatchObject({ code });
      await expect(api.projects({ userId: 2 })).rejects.toMatchObject({ code });
      await expect(api.members({ projectId: 10 })).rejects.toMatchObject({
        code,
      });
      expect(getDb).not.toHaveBeenCalled();
    }
  );
  it("accepts the normalized owner even without the generic admin role and prevents HTTP caching", async () => {
    const { api, setHeader } = caller("  AdamAmin2027@GMAIL.com ");
    expect(await api.access()).toEqual({ allowed: true });
    await api.overview();
    expect(setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store"
    );
    expect(await caller("reader@example.com", "admin").api.access()).toEqual({
      allowed: false,
    });
  });
  it("reports unavailable data instead of a misleading zero dashboard", async () => {
    const previous = state.db;
    state.db = null;
    try {
      await expect(
        caller("adamamin2027@gmail.com").api.overview()
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    } finally {
      state.db = previous;
    }
  });
});

describe("dashboard queries against PostgreSQL", () => {
  const owner = () => caller("adamamin2027@gmail.com").api;
  it("aggregates child tables independently without multiplying usage or double counting members", async () => {
    const result = await owner().overview();
    expect(result.totals).toMatchObject({
      users: 5,
      projects: 3,
      visualProjects: 1,
      documents: 4,
      transcriptions: 3,
      assets: 2,
      records: 3,
      bytes: 18000,
      unknownSize: 1,
      conversations: 2,
      cappedUsers: 1,
      queuedJobs: 1,
      runningJobs: 1,
      failedJobs: 1,
      reviewQueue: 1,
      recordReviewQueue: 1,
      approvedRecords: 1,
    });
    expect(result.trend).toHaveLength(30);
    expect(result.trend.reduce((n, d) => n + d.signups, 0)).toBe(5);
    expect(result.trend.reduce((n, d) => n + d.documents, 0)).toBe(4);
    expect(result.trend.slice(0, -1).every(d => d.signups === 0)).toBe(true);
  });
  it("lists zero-project users, attributes usage to owners, and returns only safe account fields", async () => {
    const { rows, total } = await owner().users({});
    expect(total).toBe(5);
    expect(rows.find(r => r.id === 2)).toMatchObject({
      projects: 2,
      documents: 3,
      assets: 2,
      bytes: 14000,
      transcriptions: 2,
    });
    expect(rows.find(r => r.id === 3)).toMatchObject({
      projects: 1,
      sharedProjects: 2,
      documents: 1,
      bytes: 4000,
    });
    expect(rows.find(r => r.id === 4)).toMatchObject({
      projects: 0,
      bytes: 0,
      email: null,
    });
    expect(JSON.stringify(rows)).not.toContain("SECRET");
    expect(Object.keys(rows[0])).not.toContain("openId");
  });
  it("bounds pages, searches literal text safely, and filters capped users without the owner", async () => {
    const a = await owner().users({ limit: 2 });
    const b = await owner().users({ limit: 2, page: 1 });
    expect(a.rows).toHaveLength(2);
    expect(b.rows).toHaveLength(2);
    expect(
      a.rows.map(r => r.id).some(id => b.rows.some(r => r.id === id))
    ).toBe(false);
    expect((await owner().users({ search: "%" })).rows.map(r => r.id)).toEqual([
      5,
    ]);
    expect((await owner().users({ search: "' OR 1=1 --" })).total).toBe(0);
    expect(
      (await owner().users({ cappedOnly: true })).rows.map(r => r.id)
    ).toEqual([2]);
    await expect(owner().users({ limit: 5000 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(owner().projects({ page: -1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
  it("shows owned and shared projects with the correct selected-user role and archive filter", async () => {
    const all = await owner().projects({ userId: 3 });
    expect(all.total).toBe(3);
    expect(all.rows.find(r => r.id === 10)).toMatchObject({
      userRole: "editor",
      userId: 2,
      members: 2,
      documents: 3,
      transcriptions: 2,
    });
    expect(all.rows.find(r => r.id === 12)).toMatchObject({
      userRole: "owner",
      members: 1,
    });
    const visual = await owner().projects({ userId: 3, mode: "visual_vra" });
    expect(visual.total).toBe(1);
    expect(visual.rows[0]).toMatchObject({ id: 11, assets: 2, records: 3 });
    expect((await owner().projects({ userId: 4 })).total).toBe(0);
  });
  it("includes the owner exactly once and deduplicates project membership", async () => {
    const members = await owner().members({ projectId: 10 });
    expect(members.total).toBe(2);
    expect(members.rows.map(r => [r.id, r.role])).toEqual([
      [2, "owner"],
      [3, "editor"],
    ]);
    expect(
      (await owner().members({ projectId: 12 })).rows.map(r => r.id)
    ).toEqual([3]);
    expect((await owner().members({ projectId: 999 })).rows).toEqual([]);
    expect((await owner().members({ projectId: 10, page: 10 })).total).toBe(2);
  });
  it("returns a zero-filled overview and empty lists for an empty installation", async () => {
    await database.exec(
      "truncate users, projects, documents, transcriptions, visual_assets, vra_records, jobs, project_members, research_conversations, visual_project_modes"
    );
    const result = await owner().overview();
    expect(Object.values(result.totals).every(n => n === 0)).toBe(true);
    expect(result.trend).toHaveLength(30);
    expect(
      result.trend.every(
        d => d.signups === 0 && d.documents === 0 && d.images === 0
      )
    ).toBe(true);
    expect(await owner().users({})).toEqual({ total: 0, rows: [] });
    expect(await owner().projects({})).toEqual({ total: 0, rows: [] });
  });
});

describe("cost assumptions", () => {
  const work = { transcriptions: 10, assets: 20, bytes: 2_000_000_000 };
  it("requires explicit rates and keeps lifetime workload separate from monthly storage", () => {
    expect(
      estimateCost(work, {
        transcription: null,
        visualAsset: null,
        storageGbMonth: null,
      })
    ).toEqual({ processing: null, storageMonthly: null });
    expect(
      estimateCost(work, {
        transcription: 0.02,
        visualAsset: 0.03,
        storageGbMonth: 0.1,
      })
    ).toEqual({ processing: 0.8, storageMonthly: 0.2 });
    expect(
      estimateCost(work, {
        transcription: 0,
        visualAsset: 0,
        storageGbMonth: 0,
      })
    ).toEqual({ processing: 0, storageMonthly: 0 });
    expect(
      estimateCost(work, {
        transcription: -1,
        visualAsset: 0,
        storageGbMonth: NaN,
      })
    ).toEqual({ processing: null, storageMonthly: null });
    expect(isPlatformOwner(undefined)).toBe(false);
  });
});
