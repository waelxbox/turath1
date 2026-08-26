import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getProjectRole,
  getVisualProjectMode,
  getVisualAsset,
  getVraRecord,
  listVraRecords,
  createVraRecord,
  updateVraRecord,
} = vi.hoisted(() => ({
  getProjectRole: vi.fn(),
  getVisualProjectMode: vi.fn(),
  getVisualAsset: vi.fn(),
  getVraRecord: vi.fn(),
  listVraRecords: vi.fn(),
  createVraRecord: vi.fn(),
  updateVraRecord: vi.fn(),
}));

vi.mock("./visualArchives/config", () => ({
  isVisualArchivesEnabled: () => true,
}));

vi.mock("./db", () => ({
  getProjectRole,
}));

vi.mock("./visualArchives/db", () => ({
  createVisualAsset: vi.fn(),
  createVisualProject: vi.fn(),
  createVraRecord,
  createVraRelation: vi.fn(),
  findVisualAssetByHash: vi.fn(),
  getVisualArchiveStats: vi.fn(),
  getVisualAsset,
  getVisualProjectMode,
  getVraRecord,
  listVisualAssets: vi.fn(),
  listVraRecords,
  listVraRelations: vi.fn(),
  updateVisualAsset: vi.fn(),
  updateVraRecord,
  updateVraSuggestions: vi.fn(),
}));

vi.mock("./storage", () => ({
  buildVisualAssetKey: vi.fn(),
  createVisualDerivatives: vi.fn(),
  storageGet: vi.fn(),
  storagePut: vi.fn(),
  visualAssetAccessUrl: vi.fn(),
}));

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

import { visualArchivesRouter } from "./visualArchives/router";

function caller(userId = 7) {
  return visualArchivesRouter.createCaller({
    user: { id: userId },
    req: {},
    res: {},
  } as any);
}

describe("Visual Archives router boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectRole.mockResolvedValue("owner");
    getVisualProjectMode.mockResolvedValue({ projectId: 12, archiveMode: "visual_vra" });
    listVraRecords.mockResolvedValue([]);
  });

  it("hides a visual project from users outside its tenant boundary", async () => {
    getProjectRole.mockResolvedValue(null);

    await expect(caller().listRecords({ projectId: 12 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getVisualProjectMode).not.toHaveBeenCalled();
    expect(listVraRecords).not.toHaveBeenCalled();
  });

  it("allows viewers to read but not create catalog records", async () => {
    getProjectRole.mockResolvedValue("viewer");

    await expect(caller().listRecords({ projectId: 12 })).resolves.toEqual([]);
    await expect(caller().createRecord({
      projectId: 12,
      recordType: "work",
      title: "Restricted edit",
      reviewedJson: {},
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createVraRecord).not.toHaveBeenCalled();
  });

  it("cannot attach an asset that is absent from the current project", async () => {
    getVisualAsset.mockResolvedValue(null);

    await expect(caller().createRecord({
      projectId: 12,
      recordType: "image",
      title: "Cross-project image",
      assetId: "123e4567-e89b-12d3-a456-426614174000",
      reviewedJson: {},
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getVisualAsset).toHaveBeenCalledWith(12, "123e4567-e89b-12d3-a456-426614174000");
    expect(createVraRecord).not.toHaveBeenCalled();
  });

  it("copies only explicitly accepted VRA fields into reviewed data", async () => {
    getVraRecord.mockResolvedValue({
      id: "123e4567-e89b-12d3-a456-426614174000",
      projectId: 12,
      reviewedJson: { description: "Human description" },
      aiSuggestedJson: {
        locations: ["Cairo"],
        confidenceNotes: "Visible evidence is limited",
      },
    });
    updateVraRecord.mockImplementation(async (input) => input);

    await caller().acceptSuggestionFields({
      projectId: 12,
      recordId: "123e4567-e89b-12d3-a456-426614174000",
      acceptedFields: ["locations"],
    });

    expect(updateVraRecord).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 12,
      reviewedJson: {
        description: "Human description",
        locations: ["Cairo"],
      },
      status: "draft",
    }));
  });

  it("rejects fields that are not exposed for human acceptance", async () => {
    await expect(caller().acceptSuggestionFields({
      projectId: 12,
      recordId: "123e4567-e89b-12d3-a456-426614174000",
      acceptedFields: ["confidenceNotes" as any],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getVraRecord).not.toHaveBeenCalled();
  });
});
