import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { getProjectRole } from "../db";
import {
  buildVisualAssetKey,
  createVisualDerivatives,
  storageGet,
  storagePut,
  visualAssetAccessUrl,
} from "../storage";
import { isVisualArchivesEnabled, isVisualArchivesPreviewUser } from "./config";
import {
  createVisualAsset,
  createVisualProject,
  createVraRecord,
  createVraRelation,
  findVisualAssetByHash,
  getVisualArchiveStats,
  getVisualAsset,
  getVisualProjectMode,
  getVraRecord,
  listVisualAssets,
  listVraRecords,
  listVraRelations,
  updateVisualAsset,
  updateVraRecord,
  updateVraSuggestions,
} from "./db";

const MAX_VISUAL_ASSET_BYTES = 15 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

const recordTypeSchema = z.enum(["collection", "work", "image"]);
const recordStatusSchema = z.enum(["draft", "needs_review", "approved", "archived"]);
const reviewedJsonSchema = z.record(z.string(), z.unknown());
const suggestionFieldSchema = z.enum([
  "title", "description", "workType", "agents", "dates", "locations", "subjects",
  "culturalContext", "materials", "techniques", "inscriptions", "stylePeriod",
]);

function assertFeatureEnabled(user?: { email?: string | null } | null) {
  if (!isVisualArchivesEnabled() || !isVisualArchivesPreviewUser(user)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Visual Archives is not enabled" });
  }
}

async function requireVisualRole(projectId: number, user: { id: number; email?: string | null }) {
  assertFeatureEnabled(user);
  const role = await getProjectRole(projectId, user.id);
  if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  const mode = await getVisualProjectMode(projectId);
  if (!mode) throw new TRPCError({ code: "NOT_FOUND", message: "Visual project not found" });
  return role;
}

async function requireVisualEditor(projectId: number, user: { id: number; email?: string | null }) {
  const role = await requireVisualRole(projectId, user);
  if (role === "viewer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Editor access is required" });
  }
  return role;
}

function safeAssetResponse<T extends {
  id: string;
  projectId: number;
  originalKey: string;
  displayKey: string | null;
  thumbnailKey: string | null;
}>(asset: T) {
  const { originalKey: _original, displayKey: _display, thumbnailKey: _thumbnail, ...safe } = asset;
  return {
    ...safe,
    originalUrl: visualAssetAccessUrl(asset.projectId, asset.id, "original"),
    displayUrl: asset.displayKey ? visualAssetAccessUrl(asset.projectId, asset.id, "display") : null,
    thumbnailUrl: asset.thumbnailKey ? visualAssetAccessUrl(asset.projectId, asset.id, "thumbnail") : null,
  };
}

function cleanFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? "image";
  const cleaned = basename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 180) || "image";
}

const catalogSuggestionSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    workType: { type: "array", items: { type: "string" } },
    agents: { type: "array", items: { type: "string" } },
    dates: { type: "array", items: { type: "string" } },
    locations: { type: "array", items: { type: "string" } },
    subjects: { type: "array", items: { type: "string" } },
    culturalContext: { type: "array", items: { type: "string" } },
    materials: { type: "array", items: { type: "string" } },
    techniques: { type: "array", items: { type: "string" } },
    inscriptions: { type: "array", items: { type: "string" } },
    stylePeriod: { type: "array", items: { type: "string" } },
    identificationCandidates: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          classification: { type: "string" },
          location: { type: "string" },
          rationale: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          verificationNote: { type: "string" },
        },
        required: ["name", "classification", "location", "rationale", "confidence", "verificationNote"],
        additionalProperties: false,
      },
    },
    confidenceNotes: { type: "string" },
  },
  required: [
    "title", "description", "workType", "agents", "dates", "locations", "subjects",
    "culturalContext", "materials", "techniques", "inscriptions", "stylePeriod", "identificationCandidates", "confidenceNotes",
  ],
  additionalProperties: false,
} as const;

export const visualArchivesRouter = router({
  availability: publicProcedure.query(({ ctx }) => ({
    enabled: isVisualArchivesEnabled() && isVisualArchivesPreviewUser(ctx.user),
  })),

  createProject: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(255), description: z.string().max(4000).optional() }))
    .mutation(async ({ ctx, input }) => {
      assertFeatureEnabled(ctx.user);
      return createVisualProject({ userId: ctx.user.id, name: input.name, description: input.description });
    }),

  stats: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireVisualRole(input.projectId, ctx.user);
      return getVisualArchiveStats(input.projectId);
    }),

  listAssets: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireVisualRole(input.projectId, ctx.user);
      return (await listVisualAssets(input.projectId)).map(safeAssetResponse);
    }),

  uploadAsset: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      filename: z.string().min(1).max(512),
      mimeType: z.enum(["image/jpeg", "image/png"]),
      fileBase64: z.string().min(1).max(21_000_000),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireVisualEditor(input.projectId, ctx.user);
      if (!SUPPORTED_MIME_TYPES.has(input.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only JPEG and PNG files are supported" });
      }
      const source = Buffer.from(input.fileBase64, "base64");
      if (source.length === 0 || source.length > MAX_VISUAL_ASSET_BYTES) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Visual assets must be 15 MB or smaller" });
      }
      const sha256 = crypto.createHash("sha256").update(source).digest("hex");
      const duplicate = await findVisualAssetByHash(input.projectId, sha256);
      if (duplicate) {
        throw new TRPCError({ code: "CONFLICT", message: "This image is already present in the project" });
      }
      let derivatives;
      try {
        derivatives = await createVisualDerivatives(source);
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded file is not a valid JPEG or PNG image" });
      }
      const declaredFormat = input.mimeType === "image/png" ? "png" : "jpeg";
      if (derivatives.format !== declaredFormat) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The image content does not match its declared file type" });
      }
      const assetId = crypto.randomUUID();
      const originalKey = buildVisualAssetKey(input.projectId, assetId, "original", input.mimeType);
      const displayKey = buildVisualAssetKey(input.projectId, assetId, "display", "image/jpeg");
      const thumbnailKey = buildVisualAssetKey(input.projectId, assetId, "thumbnail", "image/jpeg");
      const asset = await createVisualAsset({
        id: assetId,
        projectId: input.projectId,
        createdByUserId: ctx.user.id,
        filename: cleanFilename(input.filename),
        mimeType: input.mimeType,
        byteSize: source.length,
        sha256,
        width: derivatives.width,
        height: derivatives.height,
        originalKey,
        technicalMetadata: {
          format: derivatives.format,
          orientation: derivatives.orientation,
          density: derivatives.density,
          space: derivatives.space,
          hasAlpha: derivatives.hasAlpha,
        },
        status: "uploaded",
      });
      try {
        await storagePut(originalKey, source, input.mimeType);
        await storagePut(displayKey, derivatives.display, derivatives.displayMimeType);
        await storagePut(thumbnailKey, derivatives.thumbnail, derivatives.displayMimeType);
        const ready = await updateVisualAsset(input.projectId, assetId, {
          displayKey,
          thumbnailKey,
          status: "ready",
          errorMessage: null,
        });
        return safeAssetResponse(ready ?? asset);
      } catch (error) {
        await updateVisualAsset(input.projectId, assetId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Asset processing failed",
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Visual asset processing failed" });
      }
    }),

  listRecords: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      recordType: recordTypeSchema.optional(),
      status: recordStatusSchema.optional(),
    }))
    .query(async ({ ctx, input }) => {
      await requireVisualRole(input.projectId, ctx.user);
      return listVraRecords(input);
    }),

  createRecord: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      recordType: recordTypeSchema,
      title: z.string().min(1).max(1024),
      localIdentifier: z.string().max(255).optional(),
      assetId: z.string().uuid().optional(),
      reviewedJson: reviewedJsonSchema.default({}),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireVisualEditor(input.projectId, ctx.user);
      if (input.assetId) {
        const asset = await getVisualAsset(input.projectId, input.assetId);
        if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
      }
      return createVraRecord({
        projectId: input.projectId,
        recordType: input.recordType,
        title: input.title,
        localIdentifier: input.localIdentifier ?? null,
        assetId: input.assetId ?? null,
        reviewedJson: input.reviewedJson,
        aiSuggestedJson: {},
        suggestionProvenance: {},
        createdByUserId: ctx.user.id,
        updatedByUserId: ctx.user.id,
      });
    }),

  updateRecord: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      recordId: z.string().uuid(),
      title: z.string().min(1).max(1024).optional(),
      localIdentifier: z.string().max(255).nullable().optional(),
      reviewedJson: reviewedJsonSchema.optional(),
      status: recordStatusSchema.optional(),
      changeSummary: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireVisualEditor(input.projectId, ctx.user);
      const updated = await updateVraRecord({ ...input, userId: ctx.user.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return updated;
    }),

  createRelation: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      sourceRecordId: z.string().uuid(),
      targetRecordId: z.string().uuid(),
      relationType: z.string().min(1).max(128),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireVisualEditor(input.projectId, ctx.user);
      if (input.sourceRecordId === input.targetRecordId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A record cannot relate to itself" });
      }
      const [source, target] = await Promise.all([
        getVraRecord(input.projectId, input.sourceRecordId),
        getVraRecord(input.projectId, input.targetRecordId),
      ]);
      if (!source || !target) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return createVraRelation({
        projectId: input.projectId,
        sourceRecordId: input.sourceRecordId,
        targetRecordId: input.targetRecordId,
        relationType: input.relationType,
        status: "approved",
        createdByUserId: ctx.user.id,
        approvedByUserId: ctx.user.id,
      });
    }),

  listRelations: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireVisualRole(input.projectId, ctx.user);
      return listVraRelations(input.projectId);
    }),

  generateSuggestions: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), recordId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireVisualEditor(input.projectId, ctx.user);
      const record = await getVraRecord(input.projectId, input.recordId);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (!record.assetId) throw new TRPCError({ code: "BAD_REQUEST", message: "Attach an image before generating suggestions" });
      const asset = await getVisualAsset(input.projectId, record.assetId);
      if (!asset || asset.status !== "ready") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The attached image is not ready" });
      }
      const imageUrl = (await storageGet(asset.displayKey ?? asset.originalKey)).url;
      const response = await invokeLLM({
        model: "gemini-3.1-pro-preview",
        messages: [{
          role: "system",
          content: "You are a rigorous visual-resources cataloging assistant. Produce useful VRA Core-aligned suggestions, not merely generic scene descriptions. Describe visually grounded architectural, artistic, material, inscriptional, and contextual details with precision. When a distinctive building, monument, work, person, place, or collection appears recognizable from its visual features, use your visual knowledge to propose up to three specific identification candidates. Put every inferential or recognition-based claim in identificationCandidates, explain the visual rationale, assign calibrated high/medium/low confidence, and state what a human cataloger should verify. Do not present a candidate as established fact. Keep uncertain normal fields empty; when a candidate is high confidence, you may also propose a concise, neutral catalog title and location. Do not put labels such as '[Review Required]', confidence qualifiers, or instructions in the title field. Every response is a draft for human review and no suggestion is approved catalog data.",
        }, {
          role: "user",
          content: [
            { type: "text", text: `Suggest catalog metadata for this ${record.recordType} record. Existing title: ${record.title}` },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "vra_catalog_suggestions", strict: true, schema: catalogSuggestionSchema },
        },
        maxTokens: 4096,
      });
      const raw = response.choices[0]?.message?.content;
      if (!raw || typeof raw !== "string") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The model returned no suggestions" });
      }
      let suggestions: Record<string, unknown>;
      try {
        suggestions = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The model returned invalid suggestions" });
      }
      return updateVraSuggestions({
        projectId: input.projectId,
        recordId: input.recordId,
        aiSuggestedJson: suggestions,
        suggestionProvenance: {
          model: "gemini-3.1-pro-preview",
          generatedAt: new Date().toISOString(),
          assetId: asset.id,
          source: "visual-evidence-with-review-required-identification-candidates",
        },
      });
    }),

  acceptSuggestionFields: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      recordId: z.string().uuid(),
      acceptedFields: z.array(suggestionFieldSchema).min(1).max(12),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireVisualEditor(input.projectId, ctx.user);
      const record = await getVraRecord(input.projectId, input.recordId);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      const reviewed = { ...(record.reviewedJson as Record<string, unknown>) };
      const suggestions = record.aiSuggestedJson as Record<string, unknown>;
      let acceptedTitle: string | undefined;
      for (const field of input.acceptedFields) {
        if (field === "title" && typeof suggestions.title === "string" && suggestions.title.trim()) {
          acceptedTitle = suggestions.title.trim();
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(suggestions, field)) reviewed[field] = suggestions[field];
      }
      return updateVraRecord({
        projectId: input.projectId,
        recordId: input.recordId,
        userId: ctx.user.id,
        ...(acceptedTitle ? { title: acceptedTitle } : {}),
        reviewedJson: reviewed,
        status: "draft",
        changeSummary: `Accepted AI suggestions: ${input.acceptedFields.join(", ")}`,
      });
    }),
});
