import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { projects, users, projectMembers, projectInvites } from "../drizzle/schema";
import { eq } from "drizzle-orm";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(user: AuthenticatedUser): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const ownerUser: AuthenticatedUser = {
  id: 9990,
  openId: "test-owner-members",
  email: "owner-test@turath.io",
  name: "Test Owner",
  loginMethod: "google",
  role: "user",
  plan: "free",
  stripeCustomerId: null,
  documentQuotaUsed: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

const editorUser: AuthenticatedUser = {
  id: 9991,
  openId: "test-editor-members",
  email: "editor-test@turath.io",
  name: "Test Editor",
  loginMethod: "google",
  role: "user",
  plan: "free",
  stripeCustomerId: null,
  documentQuotaUsed: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

const viewerUser: AuthenticatedUser = {
  id: 9992,
  openId: "test-viewer-members",
  email: "viewer-test@turath.io",
  name: "Test Viewer",
  loginMethod: "google",
  role: "user",
  plan: "free",
  stripeCustomerId: null,
  documentQuotaUsed: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

let testProjectId: number;

describe("members router", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");

    // Create test users
    await db.insert(users).values([
      { id: ownerUser.id, openId: ownerUser.openId, email: ownerUser.email, name: ownerUser.name, loginMethod: "google" },
      { id: editorUser.id, openId: editorUser.openId, email: editorUser.email, name: editorUser.name, loginMethod: "google" },
      { id: viewerUser.id, openId: viewerUser.openId, email: viewerUser.email, name: viewerUser.name, loginMethod: "google" },
    ]).onConflictDoNothing();

    // Create test project owned by ownerUser
    const [proj] = await db.insert(projects).values({
      userId: ownerUser.id,
      name: "Test Members Project",
      status: "active",
    }).returning();
    testProjectId = proj.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    // Cleanup
    if (testProjectId) {
      await db.delete(projectInvites).where(eq(projectInvites.projectId, testProjectId));
      await db.delete(projectMembers).where(eq(projectMembers.projectId, testProjectId));
      await db.delete(projects).where(eq(projects.id, testProjectId));
    }
    await db.delete(users).where(eq(users.id, ownerUser.id));
    await db.delete(users).where(eq(users.id, editorUser.id));
    await db.delete(users).where(eq(users.id, viewerUser.id));
  });

  it("owner can list members (initially empty)", async () => {
    const caller = appRouter.createCaller(createContext(ownerUser));
    const result = await caller.members.list({ projectId: testProjectId });
    expect(result.currentUserRole).toBe("owner");
    expect(result.members).toHaveLength(0);
    expect(result.invites).toHaveLength(0);
  });

  it("owner can invite an existing user (auto-accepts)", async () => {
    const caller = appRouter.createCaller(createContext(ownerUser));
    const result = await caller.members.invite({
      projectId: testProjectId,
      email: editorUser.email!,
      role: "editor",
    });
    expect(result.autoAccepted).toBe(true);
  });

  it("invited user now appears in members list", async () => {
    const caller = appRouter.createCaller(createContext(ownerUser));
    const result = await caller.members.list({ projectId: testProjectId });
    expect(result.members).toHaveLength(1);
    expect(result.members[0].userEmail).toBe(editorUser.email);
    expect(result.members[0].role).toBe("editor");
  });

  it("editor can view members list", async () => {
    const caller = appRouter.createCaller(createContext(editorUser));
    const result = await caller.members.list({ projectId: testProjectId });
    expect(result.currentUserRole).toBe("editor");
    expect(result.members.length).toBeGreaterThanOrEqual(1);
  });

  it("non-member cannot view members list", async () => {
    const caller = appRouter.createCaller(createContext(viewerUser));
    await expect(caller.members.list({ projectId: testProjectId })).rejects.toThrow();
  });

  it("owner can update member role", async () => {
    const caller = appRouter.createCaller(createContext(ownerUser));
    await caller.members.updateRole({ projectId: testProjectId, userId: editorUser.id, role: "viewer" });
    const result = await caller.members.list({ projectId: testProjectId });
    expect(result.members[0].role).toBe("viewer");
  });

  it("editor (now viewer) cannot invite", async () => {
    const caller = appRouter.createCaller(createContext(editorUser));
    await expect(
      caller.members.invite({ projectId: testProjectId, email: "someone@test.com", role: "viewer" })
    ).rejects.toThrow(/Only the project owner/);
  });

  it("owner can invite a non-existing user (creates pending invite)", async () => {
    const caller = appRouter.createCaller(createContext(ownerUser));
    const result = await caller.members.invite({
      projectId: testProjectId,
      email: "newperson@example.com",
      role: "editor",
    });
    expect(result.autoAccepted).toBe(false);
    expect(result.invite.status).toBe("pending");
  });

  it("pending invite appears in list", async () => {
    const caller = appRouter.createCaller(createContext(ownerUser));
    const result = await caller.members.list({ projectId: testProjectId });
    expect(result.invites.length).toBeGreaterThanOrEqual(1);
    expect(result.invites.some(i => i.email === "newperson@example.com")).toBe(true);
  });

  it("owner can cancel a pending invite", async () => {
    const caller = appRouter.createCaller(createContext(ownerUser));
    const { invites } = await caller.members.list({ projectId: testProjectId });
    const pendingInvite = invites.find(i => i.email === "newperson@example.com");
    expect(pendingInvite).toBeDefined();
    await caller.members.cancelInvite({ projectId: testProjectId, inviteId: pendingInvite!.id });
    const after = await caller.members.list({ projectId: testProjectId });
    expect(after.invites.some(i => i.email === "newperson@example.com")).toBe(false);
  });

  it("owner can remove a member", async () => {
    const caller = appRouter.createCaller(createContext(ownerUser));
    await caller.members.remove({ projectId: testProjectId, userId: editorUser.id });
    const result = await caller.members.list({ projectId: testProjectId });
    expect(result.members).toHaveLength(0);
  });

  it("duplicate invite throws conflict error", async () => {
    const caller = appRouter.createCaller(createContext(ownerUser));
    // Re-invite editor
    await caller.members.invite({ projectId: testProjectId, email: editorUser.email!, role: "editor" });
    // Try again
    await expect(
      caller.members.invite({ projectId: testProjectId, email: editorUser.email!, role: "editor" })
    ).rejects.toThrow(/already has access/);
  });

  it("member can leave a project", async () => {
    const caller = appRouter.createCaller(createContext(editorUser));
    await caller.members.leave({ projectId: testProjectId });
    // Verify they're gone
    const ownerCaller = appRouter.createCaller(createContext(ownerUser));
    const result = await ownerCaller.members.list({ projectId: testProjectId });
    expect(result.members.find(m => m.userId === editorUser.id)).toBeUndefined();
  });
});
