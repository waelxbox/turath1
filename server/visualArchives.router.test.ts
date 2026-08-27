import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getProjectRole,
  getVisualProjectMode,
  getVisualAsset,
  getVraRecord,
  listVraRecords,
  createVraRecord,
  updateVraRecord,
  updateVraSuggestions,
  storageGet,
  storagePut,
  buildVisualAssetKey,
  createVisualDerivatives,
  createVisualAsset,
  updateVisualAsset,
  findVisualAssetByHash,
  invokeLLM,
} = vi.hoisted(() => ({
  getProjectRole: vi.fn(),
  getVisualProjectMode: vi.fn(),
  getVisualAsset: vi.fn(),
  getVraRecord: vi.fn(),
  listVraRecords: vi.fn(),
  createVraRecord: vi.fn(),
  updateVraRecord: vi.fn(),
  updateVraSuggestions: vi.fn(),
  storageGet: vi.fn(),
  storagePut: vi.fn(),
  buildVisualAssetKey: vi.fn(),
  createVisualDerivatives: vi.fn(),
  createVisualAsset: vi.fn(),
  updateVisualAsset: vi.fn(),
  findVisualAssetByHash: vi.fn(),
  invokeLLM: vi.fn(),
}));

vi.mock("./visualArchives/config", () => ({
  isVisualArchivesEnabled: () => true,
  isVisualArchivesPreviewUser: (user: { email?: string | null } | null | undefined) => user?.email === "adamamin2027@gmail.com",
}));

vi.mock("./db", () => ({
  getProjectRole,
}));

vi.mock("./visualArchives/db", () => ({
  createVisualAsset,
  createVisualProject: vi.fn(),
  createVraRecord,
  createVraRelation: vi.fn(),
  findVisualAssetByHash,
  getVisualArchiveStats: vi.fn(),
  getVisualAsset,
  getVisualProjectMode,
  getVraRecord,
  listVisualAssets: vi.fn(),
  listVraRecords,
  listVraRelations: vi.fn(),
  updateVisualAsset,
  updateVraRecord,
  updateVraSuggestions,
}));

vi.mock("./storage", () => ({
  buildVisualAssetKey,
  createVisualDerivatives,
  storageGet,
  storagePut,
  visualAssetAccessUrl: vi.fn(),
}));

vi.mock("./_core/llm", () => ({ invokeLLM }));

import { visualArchivesRouter } from "./visualArchives/router";

function caller(userId = 7, email = "adamamin2027@gmail.com") {
  return visualArchivesRouter.createCaller({
    user: { id: userId, email },
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

  function configureUploadPipeline() {
    findVisualAssetByHash.mockResolvedValue(null);
    createVisualDerivatives.mockResolvedValue({
      format: "png",
      width: 960,
      height: 640,
      display: Buffer.from("display"),
      thumbnail: Buffer.from("thumbnail"),
      displayMimeType: "image/jpeg",
      orientation: 1,
      density: 72,
      space: "srgb",
      hasAlpha: false,
    });
    buildVisualAssetKey.mockImplementation((_projectId: number, _assetId: string, variant: string) => `visual/${variant}.jpg`);
    storagePut.mockResolvedValue({ url: "https://objects.example.test/asset" });
    createVisualAsset.mockImplementation(async (input: Record<string, unknown>) => input);
    updateVisualAsset.mockImplementation(async (projectId: number, assetId: string, changes: Record<string, unknown>) => ({
      id: assetId,
      projectId,
      filename: "courtyard.png",
      originalKey: "visual/original.jpg",
      displayKey: changes.displayKey ?? null,
      thumbnailKey: changes.thumbnailKey ?? null,
      status: changes.status ?? "uploaded",
      ...changes,
    }));
    createVraRecord.mockResolvedValue({
      id: "123e4567-e89b-12d3-a456-426614174010",
      projectId: 12,
      recordType: "image",
      title: "courtyard",
    });
    storageGet.mockResolvedValue({ url: "https://objects.example.test/display.jpg" });
  }

  it("hides a visual project from users outside its tenant boundary", async () => {
    getProjectRole.mockResolvedValue(null);

    await expect(caller().listRecords({ projectId: 12 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getVisualProjectMode).not.toHaveBeenCalled();
    expect(listVraRecords).not.toHaveBeenCalled();
  });

  it("hides the controlled preview and rejects every visual operation for a non-allowlisted account", async () => {
    const outsideCaller = caller(8, "researcher@example.org");

    await expect(outsideCaller.availability()).resolves.toEqual({ enabled: false });
    await expect(outsideCaller.createProject({ name: "Not allowed" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(outsideCaller.listRecords({ projectId: 12 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getProjectRole).not.toHaveBeenCalled();
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

  it("automatically creates an Image record and separate AI draft after a successful upload", async () => {
    configureUploadPipeline();
    invokeLLM.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ title: "Courtyard", description: "Stone courtyard", workType: [], agents: [], dates: [], locations: [], subjects: [], culturalContext: [], materials: [], techniques: [], inscriptions: [], stylePeriod: [], identificationCandidates: [], confidenceNotes: "" }) } }] });

    const result = await caller().uploadAsset({
      projectId: 12,
      filename: "courtyard.png",
      mimeType: "image/png",
      fileBase64: Buffer.from("synthetic image bytes").toString("base64"),
    });

    expect(createVraRecord).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 12,
      recordType: "image",
      title: "courtyard",
      status: "needs_review",
      reviewedJson: {},
      aiSuggestedJson: {},
    }));
    expect(updateVraSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 12,
      recordId: "123e4567-e89b-12d3-a456-426614174010",
      aiSuggestedJson: expect.objectContaining({ title: "Courtyard" }),
    }));
    expect(result.autoCatalog).toEqual({ recordId: "123e4567-e89b-12d3-a456-426614174010", suggestionStatus: "generated" });
  });

  it("keeps the created Image record in the review queue if Gemini suggestions fail", async () => {
    configureUploadPipeline();
    invokeLLM.mockRejectedValue(new Error("temporary model outage"));

    const result = await caller().uploadAsset({
      projectId: 12,
      filename: "courtyard.png",
      mimeType: "image/png",
      fileBase64: Buffer.from("synthetic image bytes").toString("base64"),
    });

    expect(createVraRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "needs_review" }));
    expect(updateVraSuggestions).not.toHaveBeenCalled();
    expect(result.autoCatalog).toMatchObject({
      recordId: "123e4567-e89b-12d3-a456-426614174010",
      suggestionStatus: "pending_review",
      suggestionError: "temporary model outage",
    });
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

  it("requires an explicit action before a suggested title replaces the human title", async () => {
    getVraRecord.mockResolvedValue({
      id: "123e4567-e89b-12d3-a456-426614174000",
      projectId: 12,
      title: "images-1-",
      reviewedJson: { description: "Human description" },
      aiSuggestedJson: { title: "Nasir al-Mulk Mosque" },
    });
    updateVraRecord.mockImplementation(async (input) => input);

    await caller().acceptSuggestionFields({
      projectId: 12,
      recordId: "123e4567-e89b-12d3-a456-426614174000",
      acceptedFields: ["title"],
    });

    expect(updateVraRecord).toHaveBeenCalledWith(expect.objectContaining({
      title: "Nasir al-Mulk Mosque",
      reviewedJson: { description: "Human description" },
      status: "draft",
    }));
  });

  it("stores recognizable-place hypotheses separately with rationale and verification guidance", async () => {
    const recordId = "123e4567-e89b-12d3-a456-426614174000";
    getVraRecord.mockResolvedValue({
      id: recordId,
      projectId: 12,
      recordType: "image",
      title: "images-1-",
      assetId: "123e4567-e89b-12d3-a456-426614174001",
      reviewedJson: { description: "Human-reviewed baseline" },
    });
    getVisualAsset.mockResolvedValue({
      id: "123e4567-e89b-12d3-a456-426614174001",
      status: "ready",
      displayKey: "projects/12/visual-assets/display.jpg",
    });
    storageGet.mockResolvedValue({ url: "https://objects.example.test/display.jpg" });
    invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            title: "Nasir al-Mulk Mosque (candidate)",
            description: "Interior prayer hall with colored glass, tiled arches, and carved columns.",
            workType: ["mosque", "architectural interior"],
            agents: [], dates: [], locations: [], subjects: ["Islamic architecture"], culturalContext: [],
            materials: ["tile", "stained glass", "stone"], techniques: [], inscriptions: [], stylePeriod: [],
            identificationCandidates: [{
              name: "Nasir al-Mulk Mosque",
              classification: "mosque",
              location: "Shiraz, Iran",
              rationale: "The colored glass and tiled, arcaded prayer-hall interior are distinctive visual features.",
              confidence: "medium",
              verificationNote: "Confirm against an institutional collection record or architectural reference before acceptance.",
            }],
            confidenceNotes: "The location is a candidate identification, not established catalog data.",
          }),
        },
      }],
    });
    updateVraSuggestions.mockImplementation(async (input) => input);

    const result = await caller().generateSuggestions({ projectId: 12, recordId });

    expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-3.1-pro-preview",
      messages: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining("identification candidates") })]),
    }));
    expect(result.aiSuggestedJson).toMatchObject({
      identificationCandidates: [expect.objectContaining({ name: "Nasir al-Mulk Mosque", confidence: "medium" })],
    });
    expect(result.suggestionProvenance).toMatchObject({
      source: "visual-evidence-with-review-required-identification-candidates",
    });
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
