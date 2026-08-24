import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Cross-tenant regression tests.
 *
 * These tests exercise tRPC procedures through createCaller. The database mock
 * behaves like a tenant-aware repository: lookups only resolve when both the
 * resource id and project id match. Mutation spies let us prove that a rejected
 * request caused no partial write.
 */

const ids = {
  attackerUser: 101,
  victimUser: 202,
  attackerProject: 1_001,
  victimProject: 2_002,
  ownedDocument: 10_001,
  victimDocument: 20_002,
  victimTranscription: 30_003,
  ownedGroup: 40_001,
  victimGroup: 40_002,
  victimSession: 50_002,
  victimValidationAssignment: 60_002,
  victimDocumentAssignment: 61_002,
  victimSuggestion: 70_002,
  victimEntityA: 80_002,
  victimEntityB: 80_003,
} as const;

const db = vi.hoisted(() => {
  const emptySelect = {
    from: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  };

  return {
    getDb: vi.fn(async () => ({ select: vi.fn(() => emptySelect) })),
    getProjectById: vi.fn(async (projectId: number, userId: number) => {
      if (projectId !== 1_001 || userId !== 101) return undefined;
      return {
        id: 1_001,
        userId: 101,
        name: "Attacker project",
        status: "active",
        jsonSchema: {},
      };
    }),
    getProjectRole: vi.fn(async (projectId: number, userId: number) =>
      projectId === 1_001 && userId === 101 ? "owner" : null),
    getDocumentById: vi.fn(async (documentId: number, projectId: number) => {
      if (documentId !== 10_001 || projectId !== 1_001) return undefined;
      return {
        id: 10_001,
        projectId: 1_001,
        filename: "owned-page.jpg",
        storagePath: "projects/1001/documents/owned-page.jpg",
        storageUrl: "https://storage.invalid/owned-page.jpg",
        mimeType: "image/jpeg",
        status: "needs_review",
      };
    }),
    getTranscriptionByDocumentId: vi.fn(async (documentId: number, projectId?: number) => {
      // Models the baseline vulnerability: an unscoped lookup reveals the row,
      // while a tenant-scoped lookup correctly finds nothing in this project.
      if (documentId === 20_002 && projectId === undefined) {
        return {
          id: 30_003,
          documentId: 20_002,
          projectId: 2_002,
          rawJson: { text: "VICTIM TRANSCRIPTION" },
        };
      }
      return undefined;
    }),
    getEntitiesByDocument: vi.fn(async () => [
      { id: 80_002, name: "VICTIM ENTITY", type: "person" },
    ]),
    getDocumentGroupById: vi.fn(async (groupId: number) => {
      if (groupId === 40_001) return { id: 40_001, projectId: 1_001, pageCount: 1 };
      if (groupId === 40_002) return { id: 40_002, projectId: 2_002, pageCount: 1 };
      return null;
    }),
    getDocumentGroupPages: vi.fn(async (groupId: number) =>
      groupId === 40_002
        ? [{ id: 20_002, projectId: 2_002, filename: "victim.jpg" }]
        : []),
    getValidationSessionById: vi.fn(async (sessionId: number) =>
      sessionId === 50_002 ? { id: 50_002, projectId: 2_002 } : null),
    getAssignmentById: vi.fn(async (assignmentId: number) =>
      assignmentId === 60_002
        ? { id: 60_002, sessionId: 50_002, documentId: 20_002, reviewerUsername: "victim" }
        : null),
    getDocumentAssignmentById: vi.fn(async (assignmentId: number) =>
      assignmentId === 61_002 ? { id: 61_002, projectId: 2_002, documentId: 20_002 } : null),
    getMergeSuggestionById: vi.fn(async (suggestionId: number) =>
      suggestionId === 70_002 ? { id: 70_002, projectId: 2_002, entityIds: [80_002, 80_003] } : null),
    getEntitiesByIds: vi.fn(async () => [
      { id: 80_002, projectId: 2_002 },
      { id: 80_003, projectId: 2_002 },
    ]),

    updateDocumentStatus: vi.fn(async () => undefined),
    deleteDocument: vi.fn(async () => undefined),
    updateReviewedJson: vi.fn(async () => undefined),
    createDocumentGroup: vi.fn(async () => ({ id: 49_999, projectId: 1_001, pageCount: 1 })),
    addDocumentToGroup: vi.fn(async () => undefined),
    removeDocumentFromGroup: vi.fn(async () => undefined),
    reorderGroupPages: vi.fn(async () => undefined),
    updateDocumentGroupTitle: vi.fn(async () => undefined),
    updateDocumentGroupMetadata: vi.fn(async () => undefined),
    deleteDocumentGroup: vi.fn(async () => undefined),
    createValidationSession: vi.fn(async () => ({ id: 59_999, projectId: 1_001 })),
    getValidationStats: vi.fn(async () => ({ session: { id: 50_002 }, victimSecret: true })),
    closeValidationSession: vi.fn(async () => undefined),
    deleteValidationSession: vi.fn(async () => undefined),
    submitLineVerdict: vi.fn(async () => undefined),
    completeAssignment: vi.fn(async () => undefined),
    assignDocuments: vi.fn(async ({ documentIds }: { documentIds: number[] }) => ({ assigned: documentIds.length })),
    updateAssignmentStatus: vi.fn(async () => undefined),
    deleteAssignment: vi.fn(async () => undefined),
    getTranscriptionsByDocumentIds: vi.fn(async (projectId: number, documentIds: number[]) => {
      if (projectId === 1_001 && documentIds.includes(20_002)) return [];
      return [];
    }),
    logActivity: vi.fn(async () => undefined),
  };
});

const merge = vi.hoisted(() => ({
  generateMergeSuggestions: vi.fn(async () => ({ created: 0 })),
  executeMerge: vi.fn(async () => undefined),
  rejectMerge: vi.fn(async () => undefined),
  skipMerge: vi.fn(async () => undefined),
  processMergeStep: vi.fn(async () => ({ suggestionsCreated: 0 })),
  manualMerge: vi.fn(async () => undefined),
}));

const storage = vi.hoisted(() => ({
  storagePut: vi.fn(),
  storageGet: vi.fn(async () => ({ key: "owned", url: "https://storage.invalid/owned" })),
}));

vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<typeof import("./db")>()),
  ...db,
}));

vi.mock("./entityMergeService", () => merge);
vi.mock("./storage", () => storage);
vi.mock("./embeddingService", () => ({
  embedTranscription: vi.fn(async () => undefined),
  semanticSearch: vi.fn(async () => []),
}));
vi.mock("./nerService", () => ({
  extractAndStoreEntities: vi.fn(async () => undefined),
  reconcileDocumentEntities: vi.fn(async () => undefined),
}));

import { appRouter } from "./routers";

const attacker = {
  id: ids.attackerUser,
  openId: "attacker-open-id",
  email: "attacker@example.test",
  name: "Attacker",
  loginMethod: "google",
  role: "user",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  lastSignedIn: new Date("2026-01-01"),
} as NonNullable<TrpcContext["user"]>;

function createContext(): TrpcContext {
  return {
    user: attacker,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function caller() {
  return appRouter.createCaller(createContext());
}

function expectSecurityError(error: unknown) {
  expect(error).toMatchObject({
    code: expect.stringMatching(/^(BAD_REQUEST|FORBIDDEN|NOT_FOUND|UNAUTHORIZED)$/),
  });
}

async function expectDenied(action: Promise<unknown>) {
  try {
    await action;
    throw new Error("Expected cross-tenant request to be denied");
  } catch (error) {
    if (error instanceof Error && error.message === "Expected cross-tenant request to be denied") throw error;
    expectSecurityError(error);
  }
}

async function expectNoSensitiveRead(action: Promise<unknown>) {
  let value: unknown;
  try {
    value = await action;
  } catch (error) {
    expectSecurityError(error);
    return;
  }

  if (Array.isArray(value)) {
    expect(value).toEqual([]);
  } else {
    expect(value).toBeNull();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("document and transcription tenant boundaries", () => {
  it("does not issue a storage URL for a foreign document", async () => {
    await expectDenied(caller().documents.getImageUrl({
      projectId: ids.attackerProject,
      documentId: ids.victimDocument,
    }));
    expect(storage.storageGet).not.toHaveBeenCalled();
  });

  it("rejects a mixed-project bulk status change without a partial write", async () => {
    await expectDenied(caller().documents.bulkChangeStatus({
      projectId: ids.attackerProject,
      documentIds: [ids.ownedDocument, ids.victimDocument],
      status: "reviewed",
    }));
    expect(db.updateDocumentStatus).not.toHaveBeenCalled();
  });

  it("rejects a mixed-project bulk deletion without a partial write", async () => {
    await expectDenied(caller().documents.bulkDelete({
      projectId: ids.attackerProject,
      documentIds: [ids.ownedDocument, ids.victimDocument],
    }));
    expect(db.deleteDocument).not.toHaveBeenCalled();
  });

  it("does not return a foreign transcription through an owned project", async () => {
    await expectNoSensitiveRead(caller().transcriptions.getByDocument({
      projectId: ids.attackerProject,
      documentId: ids.victimDocument,
    }));
  });

  it("rejects saving a review against foreign document/transcription ids", async () => {
    await expectDenied(caller().transcriptions.saveReview({
      projectId: ids.attackerProject,
      documentId: ids.victimDocument,
      transcriptionId: ids.victimTranscription,
      reviewedJson: { text: "attacker overwrite" },
      status: "reviewed",
    }));
    expect(db.updateReviewedJson).not.toHaveBeenCalled();
    expect(db.updateDocumentStatus).not.toHaveBeenCalled();
  });

  it("scopes explicitly selected export document ids to the requested project", async () => {
    const result = await caller().export.csv({
      projectId: ids.attackerProject,
      documentIds: [ids.victimDocument],
      includeAll: false,
    });
    expect(result).toEqual({ csv: "", count: 0 });
    expect(db.getTranscriptionsByDocumentIds).toHaveBeenCalledWith(
      ids.attackerProject,
      [ids.victimDocument],
    );
  });
});

describe("entity and merge tenant boundaries", () => {
  it("does not reveal entities linked to a foreign document", async () => {
    await expectNoSensitiveRead(caller().entities.byDocument({
      projectId: ids.attackerProject,
      documentId: ids.victimDocument,
    }));
  });

  it.each([
    ["accept", () => caller().merge.accept({
      projectId: ids.attackerProject,
      suggestionId: ids.victimSuggestion,
      canonicalName: "Attacker canonical",
      entityIds: [ids.victimEntityA, ids.victimEntityB],
    }), merge.executeMerge],
    ["reject", () => caller().merge.reject({
      projectId: ids.attackerProject,
      suggestionId: ids.victimSuggestion,
    }), merge.rejectMerge],
    ["skip", () => caller().merge.skip({
      projectId: ids.attackerProject,
      suggestionId: ids.victimSuggestion,
    }), merge.skipMerge],
    ["manual", () => caller().merge.manual({
      projectId: ids.attackerProject,
      canonicalName: "Attacker canonical",
      entityIds: [ids.victimEntityA, ids.victimEntityB],
    }), merge.manualMerge],
  ] as const)("rejects %s against foreign merge resources", async (_name, action, mutation) => {
    await expectDenied(action());
    expect(mutation).not.toHaveBeenCalled();
  });
});

describe("multi-page group tenant boundaries", () => {
  it("does not reveal a foreign group", async () => {
    await expectDenied(caller().groups.getById({
      projectId: ids.attackerProject,
      groupId: ids.victimGroup,
    }));
    expect(db.getDocumentGroupPages).not.toHaveBeenCalled();
  });

  it("does not create a group containing foreign documents", async () => {
    await expectDenied(caller().groups.create({
      projectId: ids.attackerProject,
      title: "Cross-tenant group",
      documentIds: [ids.ownedDocument, ids.victimDocument],
    }));
    expect(db.createDocumentGroup).not.toHaveBeenCalled();
    expect(db.addDocumentToGroup).not.toHaveBeenCalled();
  });

  it("does not add a foreign document to an owned group", async () => {
    await expectDenied(caller().groups.addPage({
      projectId: ids.attackerProject,
      groupId: ids.ownedGroup,
      documentId: ids.victimDocument,
    }));
    expect(db.addDocumentToGroup).not.toHaveBeenCalled();
  });

  it("does not add any document to a foreign group", async () => {
    await expectDenied(caller().groups.addPage({
      projectId: ids.attackerProject,
      groupId: ids.victimGroup,
      documentId: ids.ownedDocument,
    }));
    expect(db.addDocumentToGroup).not.toHaveBeenCalled();
  });

  it("does not detach a foreign document from its group", async () => {
    await expectDenied(caller().groups.removePage({
      projectId: ids.attackerProject,
      documentId: ids.victimDocument,
    }));
    expect(db.removeDocumentFromGroup).not.toHaveBeenCalled();
  });

  it("rejects mixed-project bulk removal without a partial write", async () => {
    await expectDenied(caller().groups.removePages({
      projectId: ids.attackerProject,
      documentIds: [ids.ownedDocument, ids.victimDocument],
    }));
    expect(db.removeDocumentFromGroup).not.toHaveBeenCalled();
  });

  it("does not reorder pages in a foreign group", async () => {
    await expectDenied(caller().groups.reorderPages({
      projectId: ids.attackerProject,
      groupId: ids.victimGroup,
      orderedDocIds: [ids.victimDocument],
    }));
    expect(db.reorderGroupPages).not.toHaveBeenCalled();
  });

  it("does not start group transcription for a foreign group", async () => {
    await expectDenied(caller().groups.batchTranscribeAll({
      projectId: ids.attackerProject,
      groupId: ids.victimGroup,
    }));
    expect(db.getDocumentGroupPages).not.toHaveBeenCalled();
    expect(db.updateDocumentStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["rename", () => caller().groups.updateTitle({
      projectId: ids.attackerProject,
      groupId: ids.victimGroup,
      title: "Attacker title",
    }), db.updateDocumentGroupTitle],
    ["update metadata", () => caller().groups.updateSharedMetadata({
      projectId: ids.attackerProject,
      groupId: ids.victimGroup,
      sharedMetadata: { overwritten: true },
    }), db.updateDocumentGroupMetadata],
    ["delete", () => caller().groups.delete({
      projectId: ids.attackerProject,
      groupId: ids.victimGroup,
    }), db.deleteDocumentGroup],
  ] as const)("does not %s a foreign group", async (_name, action, mutation) => {
    await expectDenied(action());
    expect(mutation).not.toHaveBeenCalled();
  });
});

describe("validation tenant and capability boundaries", () => {
  it("does not create a validation session containing foreign documents", async () => {
    await expectDenied(caller().validation.create({
      projectId: ids.attackerProject,
      title: "Foreign corpus",
      documentIds: [ids.victimDocument],
    }));
    expect(db.createValidationSession).not.toHaveBeenCalled();
  });

  it("does not return stats for a foreign session", async () => {
    await expectNoSensitiveRead(caller().validation.stats({
      projectId: ids.attackerProject,
      sessionId: ids.victimSession,
    }));
    expect(db.getValidationStats).not.toHaveBeenCalled();
  });

  it.each([
    ["close", () => caller().validation.close({
      projectId: ids.attackerProject,
      sessionId: ids.victimSession,
    }), db.closeValidationSession],
    ["delete", () => caller().validation.delete({
      projectId: ids.attackerProject,
      sessionId: ids.victimSession,
    }), db.deleteValidationSession],
  ] as const)("does not %s a foreign validation session", async (_name, action, mutation) => {
    await expectDenied(action());
    expect(mutation).not.toHaveBeenCalled();
  });

  it("does not accept a forged public verdict without a session capability", async () => {
    await expectDenied(caller().validation.submitVerdict({
      assignmentId: ids.victimValidationAssignment,
      shareToken: "missing-capability",
      reviewerUsername: "attacker",
      lineIndex: 0,
      lineText: "forged",
      verdict: "correct",
    }));
    expect(db.submitLineVerdict).not.toHaveBeenCalled();
  });

  it("does not complete an assignment without a session capability", async () => {
    await expectDenied(caller().validation.completeAssignment({
      assignmentId: ids.victimValidationAssignment,
      shareToken: "missing-capability",
      reviewerUsername: "attacker",
      totalLines: 1,
    }));
    expect(db.completeAssignment).not.toHaveBeenCalled();
  });
});

describe("review assignment tenant boundaries", () => {
  it("does not assign a foreign document", async () => {
    await expectDenied(caller().assignments.assign({
      projectId: ids.attackerProject,
      documentIds: [ids.victimDocument],
      assigneeId: ids.attackerUser,
    }));
    expect(db.assignDocuments).not.toHaveBeenCalled();
  });

  it("does not assign documents to a non-member", async () => {
    await expectDenied(caller().assignments.assign({
      projectId: ids.attackerProject,
      documentIds: [ids.ownedDocument],
      assigneeId: ids.victimUser,
    }));
    expect(db.assignDocuments).not.toHaveBeenCalled();
  });

  it("does not update a foreign assignment", async () => {
    await expectDenied(caller().assignments.updateStatus({
      projectId: ids.attackerProject,
      assignmentId: ids.victimDocumentAssignment,
      status: "completed",
    }));
    expect(db.updateAssignmentStatus).not.toHaveBeenCalled();
  });

  it("does not delete a foreign assignment", async () => {
    await expectDenied(caller().assignments.delete({
      projectId: ids.attackerProject,
      assignmentId: ids.victimDocumentAssignment,
    }));
    expect(db.deleteAssignment).not.toHaveBeenCalled();
  });
});
