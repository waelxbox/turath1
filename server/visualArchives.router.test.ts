import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getProjectRole,
  getVisualProjectMode,
  getVisualAsset,
  getImageRecordByAssetId,
  getVisualAssetsByIds,
  getVraRecord,
  getVraRecordsByIds,
  linkImageRecordsToWork,
  listVisualAssetsPage,
  listVraRecords,
  listVraRecordsPage,
  unlinkImageRecordsFromWork,
  createVraRecord,
  acceptVraSuggestionFields,
  rejectVraSuggestionFields,
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
  getImageRecordByAssetId: vi.fn(),
  getVisualAssetsByIds: vi.fn(),
  getVraRecord: vi.fn(),
  getVraRecordsByIds: vi.fn(),
  linkImageRecordsToWork: vi.fn(),
  listVisualAssetsPage: vi.fn(),
  listVraRecords: vi.fn(),
  listVraRecordsPage: vi.fn(),
  unlinkImageRecordsFromWork: vi.fn(),
  createVraRecord: vi.fn(),
  acceptVraSuggestionFields: vi.fn(),
  rejectVraSuggestionFields: vi.fn(),
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
  acceptVraSuggestionFields,
  createVraRelation: vi.fn(),
  findVisualAssetByHash,
  getVisualArchiveStats: vi.fn(),
  getVisualAsset,
  getImageRecordByAssetId,
  getVisualAssetsByIds,
  getVisualProjectMode,
  getVraRecord,
  getVraRecordsByIds,
  linkImageRecordsToWork,
  listVisualAssets: vi.fn(),
  listVisualAssetsPage,
  listVraRecords,
  listVraRecordsPage,
  listVraRelations: vi.fn(),
  rejectVraSuggestionFields,
  unlinkImageRecordsFromWork,
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
    getVisualAssetsByIds.mockResolvedValue([]);
    listVraRecords.mockResolvedValue([]);
    listVraRecordsPage.mockResolvedValue({ items: [], total: 0, nextCursor: null });
    listVisualAssetsPage.mockResolvedValue({ items: [], total: 0, nextCursor: null });
    acceptVraSuggestionFields.mockImplementation(async (input: Record<string, unknown>) => input);
    rejectVraSuggestionFields.mockImplementation(async (input: Record<string, unknown>) => input);
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

  it("pages Visual Archive records inside the authorized project only", async () => {
    listVraRecordsPage.mockResolvedValue({
      items: [{ id: "123e4567-e89b-12d3-a456-426614174000", title: "Courtyard", updatedAt: new Date("2026-08-27T00:00:00.000Z") }],
      total: 101,
      nextCursor: { createdAt: "2026-08-27T00:00:00.000Z", id: "123e4567-e89b-12d3-a456-426614174000" },
    });

    const result = await caller().listRecordsPage({ projectId: 12, recordType: "image", status: "needs_review", limit: 48 });

    expect(result.total).toBe(101);
    expect(listVraRecordsPage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 12, recordType: "image", status: "needs_review", limit: 48 }));
  });

  it("searches only human-reviewed catalog evidence and omits AI drafts from discovery results", async () => {
    listVraRecords.mockResolvedValue([{
      id: "123e4567-e89b-12d3-a456-426614174006",
      projectId: 12,
      recordType: "image",
      status: "approved",
      title: "Courtyard photograph",
      localIdentifier: null,
      assetId: "123e4567-e89b-12d3-a456-426614174007",
      reviewedJson: { locations: ["Cairo"], subjects: ["courtyards"] },
      aiSuggestedJson: { locations: ["Shiraz"] },
      suggestionProvenance: { model: "gemini" },
    }]);
    getVisualAssetsByIds.mockResolvedValue([]);

    const result = await caller().searchReviewedCatalog({ projectId: 12, query: "Cairo", limit: 48 });

    expect(result.total).toBe(1);
    expect(result.facets.locations).toEqual([{ value: "Cairo", count: 1 }]);
    expect(result.items[0]).not.toHaveProperty("aiSuggestedJson");
    expect(result.items[0]).not.toHaveProperty("suggestionProvenance");
  });

  it("answers visual archive questions only from approved records and returns cited protected evidence", async () => {
    const recordId = "123e4567-e89b-12d3-a456-426614174011";
    const assetId = "123e4567-e89b-12d3-a456-426614174012";
    listVraRecords.mockResolvedValue([{
      id: recordId, projectId: 12, recordType: "image", status: "approved", title: "Courtyard photograph", localIdentifier: null, assetId,
      reviewedJson: { locations: ["Cairo"], materials: ["limestone"] }, aiSuggestedJson: { locations: ["Secret AI draft place"] }, suggestionProvenance: {}, updatedAt: new Date(),
    }]);
    getVisualAssetsByIds.mockResolvedValue([{ id: assetId, status: "ready", originalKey: "visual/original.jpg", displayKey: "visual/display.jpg", thumbnailKey: "visual/thumbnail.jpg" }]);
    storageGet.mockResolvedValue({ url: "https://objects.example.test/display.jpg" });
    invokeLLM.mockResolvedValue({ choices: [{ message: { content: "The reviewed catalog identifies a Cairo location. [Record 1]" } }] });

    const result = await caller().askArchive({ projectId: 12, question: "What is in Cairo?" });

    expect(result.answer).toContain("[Record 1]");
    expect(result.insufficientEvidence).toBe(false);
    expect(result.sources).toEqual([expect.objectContaining({ index: 1, recordId, title: "Courtyard photograph", matchedFields: ["locations"], thumbnailUrl: undefined })]);
    const call = invokeLLM.mock.calls[0]?.[0];
    expect(JSON.stringify(call)).toContain("Cairo");
    expect(JSON.stringify(call)).not.toContain("Secret AI draft place");
  });

  it("does not invoke Gemini when a Visual Archive has no approved records", async () => {
    listVraRecords.mockResolvedValue([]);

    const result = await caller().askArchive({ projectId: 12, question: "What is pictured?" });

    expect(result.sources).toEqual([]);
    expect(result.answer).toContain("No approved catalog records");
    expect(result.insufficientEvidence).toBe(true);
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it("returns an insufficient-evidence response rather than making an unsupported visual archive inference", async () => {
    listVraRecords.mockResolvedValue([{
      id: "123e4567-e89b-12d3-a456-426614174011", projectId: 12, recordType: "image", status: "approved", title: "Courtyard photograph", localIdentifier: null, assetId: null,
      reviewedJson: { locations: ["Cairo"] }, aiSuggestedJson: { locations: ["Hidden draft"] }, suggestionProvenance: {}, updatedAt: new Date(),
    }]);

    const result = await caller().askArchive({ projectId: 12, question: "Which images show a glacier?" });

    expect(result.insufficientEvidence).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain("not have enough approved catalog evidence");
    expect(invokeLLM).not.toHaveBeenCalled();
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

  it("returns the existing Image review record when an interrupted intake retry reselects an identical image", async () => {
    const assetId = "123e4567-e89b-12d3-a456-426614174001";
    findVisualAssetByHash.mockResolvedValue({
      id: assetId,
      projectId: 12,
      originalKey: "visual/original.jpg",
      displayKey: "visual/display.jpg",
      thumbnailKey: "visual/thumbnail.jpg",
      status: "ready",
    });
    getImageRecordByAssetId.mockResolvedValue({ id: "123e4567-e89b-12d3-a456-426614174010" });

    const result = await caller().uploadAsset({
      projectId: 12,
      filename: "courtyard.png",
      mimeType: "image/png",
      fileBase64: Buffer.from("synthetic image bytes").toString("base64"),
    });

    expect(result.autoCatalog).toEqual({ recordId: "123e4567-e89b-12d3-a456-426614174010", suggestionStatus: "already_present" });
    expect(createVisualAsset).not.toHaveBeenCalled();
    expect(createVraRecord).not.toHaveBeenCalled();
  });

  it("bulk-links selected Image records to a human-chosen Work without merging them", async () => {
    const workId = "123e4567-e89b-12d3-a456-426614174020";
    const imageIds = ["123e4567-e89b-12d3-a456-426614174021", "123e4567-e89b-12d3-a456-426614174022"];
    getVraRecord.mockResolvedValue({ id: workId, projectId: 12, recordType: "work" });
    linkImageRecordsToWork.mockResolvedValue({ linked: 2 });

    await expect(caller().linkImagesToWork({ projectId: 12, workRecordId: workId, imageRecordIds: imageIds })).resolves.toEqual({ linked: 2 });
    expect(linkImageRecordsToWork).toHaveBeenCalledWith(expect.objectContaining({ projectId: 12, workRecordId: workId, imageRecordIds: imageIds, userId: 7, evidenceJson: expect.objectContaining({ source: "human_bulk_grouping" }) }));
  });

  it("returns a review-only same-site hypothesis without creating a Work or relation", async () => {
    const imageIds = ["123e4567-e89b-12d3-a456-426614174041", "123e4567-e89b-12d3-a456-426614174042"];
    getVraRecordsByIds.mockResolvedValue(imageIds.map((id, index) => ({
      id,
      projectId: 12,
      recordType: "image",
      title: `Mosque view ${index + 1}`,
      assetId: `123e4567-e89b-12d3-a456-42661417405${index}`,
      reviewedJson: {},
      aiSuggestedJson: {},
    })));
    getVisualAsset.mockResolvedValue({ status: "ready", originalKey: "visual/original.jpg", displayKey: "visual/display.jpg" });
    storageGet.mockResolvedValue({ url: "https://objects.example.test/display.jpg" });
    invokeLLM.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      relationship: "same_site", proposedWorkTitle: "Nasir al-Mulk Mosque, Shiraz", classification: "mosque", location: "Shiraz, Iran",
      rationale: "Both Images show the same tiled interior and colored-glass windows.", confidence: "medium",
      verificationNote: "Confirm against an institutional record before creating a Work link.",
    }) } }] });

    const result = await caller().suggestImageGrouping({ projectId: 12, imageRecordIds: imageIds });

    expect(result).toMatchObject({ relationship: "same_site", proposedWorkTitle: "Nasir al-Mulk Mosque, Shiraz", reviewedByHuman: false, evaluatedRecordIds: imageIds });
    expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.1-pro-preview" }));
    expect(linkImageRecordsToWork).not.toHaveBeenCalled();
    expect(createVraRecord).not.toHaveBeenCalled();
  });

  it("keeps bulk record state changes project-scoped and writes each record through the revision path", async () => {
    const recordIds = ["123e4567-e89b-12d3-a456-426614174031", "123e4567-e89b-12d3-a456-426614174032"];
    getVraRecordsByIds.mockResolvedValue(recordIds.map(id => ({ id, projectId: 12, recordType: "image" })));
    updateVraRecord.mockResolvedValue({});

    await expect(caller().bulkSetRecordStatus({ projectId: 12, recordIds, status: "approved" })).resolves.toEqual({ updated: 2 });
    expect(updateVraRecord).toHaveBeenCalledTimes(2);
    expect(updateVraRecord).toHaveBeenCalledWith(expect.objectContaining({ projectId: 12, status: "approved", changeSummary: "Bulk status change to approved" }));
  });

  it("routes explicitly accepted VRA fields through the atomic locked revision helper", async () => {
    await caller().acceptSuggestionFields({
      projectId: 12,
      recordId: "123e4567-e89b-12d3-a456-426614174000",
      acceptedFields: ["locations"],
    });

    expect(acceptVraSuggestionFields).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 12,
      recordId: "123e4567-e89b-12d3-a456-426614174000",
      userId: 7,
      acceptedFields: ["locations"],
    }));
  });

  it("routes rapid independent acceptance clicks through the locked helper without stale router-side metadata merges", async () => {
    await Promise.all([
      caller().acceptSuggestionFields({
        projectId: 12,
        recordId: "123e4567-e89b-12d3-a456-426614174000",
        acceptedFields: ["locations"],
      }),
      caller().acceptSuggestionFields({
        projectId: 12,
        recordId: "123e4567-e89b-12d3-a456-426614174000",
        acceptedFields: ["workType"],
      }),
    ]);

    expect(acceptVraSuggestionFields).toHaveBeenCalledTimes(2);
    expect(acceptVraSuggestionFields).toHaveBeenNthCalledWith(1, expect.objectContaining({ acceptedFields: ["locations"] }));
    expect(acceptVraSuggestionFields).toHaveBeenNthCalledWith(2, expect.objectContaining({ acceptedFields: ["workType"] }));
    expect(updateVraRecord).not.toHaveBeenCalled();
  });

  it("requires an explicit action before a suggested title replaces the human title", async () => {
    await caller().acceptSuggestionFields({
      projectId: 12,
      recordId: "123e4567-e89b-12d3-a456-426614174000",
      acceptedFields: ["title"],
    });

    expect(acceptVraSuggestionFields).toHaveBeenCalledWith(expect.objectContaining({ acceptedFields: ["title"] }));
  });

  it("records an explicit suggestion rejection without modifying reviewed catalog data in the router", async () => {
    await caller().rejectSuggestionFields({
      projectId: 12,
      recordId: "123e4567-e89b-12d3-a456-426614174000",
      rejectedFields: ["workType"],
    });

    expect(rejectVraSuggestionFields).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 12,
      recordId: "123e4567-e89b-12d3-a456-426614174000",
      userId: 7,
      rejectedFields: ["workType"],
    }));
    expect(updateVraRecord).not.toHaveBeenCalled();
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
