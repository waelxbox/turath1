import { z } from "zod";
import { adminRouter } from "./admin/router";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  getProjectsByUserId,
  getProjectById,
  getProjectRole,
  createProject,
  updateProject,
  getProjectStats,
  createOnboardingSample,
  getSamplesByProjectId,
  updateSampleAiOutput,
  createDocument,
  getDocumentsByProjectId,
  getDocumentById,
  updateDocumentStatus,
  createTranscription,
  getTranscriptionByDocumentId,
  updateReviewedJson,
  getReviewedTranscriptions,
  getAllTranscriptions,
  getTranscriptionsByDocumentIds,
  getTranscriptionsByStatus,
  getReviewedDocsWithoutEmbeddings,
  getAllDocsWithoutEmbeddings,
  createJob,
  getJobsByProjectId,
  updateJob,
  deleteProject,
  deleteDocument,
  renameDocument,
  getDocumentsPaginated,
  getProjectLanguages,
  getProjectMembers,
  addProjectMember,
  removeProjectMember,
  updateMemberRole,
  createProjectInvite,
  getProjectInvites,
  getInviteByToken,
  getPendingInvitesByEmail,
  acceptInvite,
  cancelInvite,
  getUserByEmail,
  getEntityAliases,
  getEntityAliasesBatch,
  searchEntitiesByNameOrAlias,
  updateEntityName,
  deleteEntities,
  createDocumentGroup,
  getDocumentGroupsByProject,
  getDocumentGroupById,
  getDocumentGroupPages,
  addDocumentToGroup,
  removeDocumentFromGroup,
  updateDocumentGroupMetadata,
  updateDocumentGroupTitle,
  deleteDocumentGroup,
  reorderGroupPages,
  logActivity,
  getActivityFeed,
  assignDocuments,
  getMyQueue,
  getProjectAssignments,
  updateAssignmentStatus,
  deleteAssignment,
  getAssignmentStats,
  getValidationSessionById,
  getDocumentAssignmentById,
  getMergeSuggestionById,
  getEntitiesByIds,
  getDocumentQuotaStatus,
  releaseDocumentQuotaSlot,
  reserveDocumentQuotaSlot,
} from "./db";
import crypto from "crypto";
import { generateProjectConfig, validateConfig, refineConfig } from "./onboardingAgent";
import { processOnboardingChat, generateConfigFromChat, type ChatMessage } from "./onboardingChat";
import { processDocument, crossCheckTranscription } from "./transcriptionEngine";
import {
  documentAccessUrl,
  onboardingSampleAccessUrl,
  storagePut,
  validationDocumentAccessUrl,
} from "./storage";
import { TRPCError } from "@trpc/server";
import { embedTranscription, semanticSearch } from "./embeddingService";
import { extractAndStoreEntities, reconcileDocumentEntities } from "./nerService";
import { generateMergeSuggestions, executeMerge, rejectMerge, skipMerge, processMergeStep, manualMerge } from "./entityMergeService";
import { invokeLLM } from "./_core/llm";
import { seedDemoProject } from "./demoSeed";
import { awardXp, getUserStats, getLeaderboard, maybeAwardStreakBonus, XP_VALUES, xpProgressInLevel } from "./gamification";
import { getReviewSession, saveReviewSession, createValidationSession, getValidationSessionByToken, getValidationSessionsByProject, closeValidationSession, deleteValidationSession, getNextAssignment, getAssignmentById, submitLineVerdict, completeAssignment, getReviewerProgress, getValidationStats, getReviewsForAssignment, getResearchConversations, getResearchConversation, createResearchConversation, updateResearchConversation, deleteResearchConversation } from "./db";
import { runResearchAgent } from "./researchAgent";
import { visualArchivesRouter } from "./visualArchives/router";
import { getVisualProjectIds, getVisualProjectMode } from "./visualArchives/db";
import { isVisualArchivesEnabled, isVisualArchivesPreviewUser } from "./visualArchives/config";

type ProjectRole = "owner" | "editor" | "viewer";

const STORAGE_FETCH_TIMEOUT_MS = 30_000;

async function fetchStorageObject(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(STORAGE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Storage download failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function requireProjectAccess(projectId: number, userId: number): Promise<ProjectRole> {
  const role = await getProjectRole(projectId, userId);
  if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  return role;
}

async function requireProjectEditor(projectId: number, userId: number): Promise<"owner" | "editor"> {
  const role = await requireProjectAccess(projectId, userId);
  if (role === "viewer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Editor access is required" });
  }
  return role;
}

async function requireProjectDocuments(projectId: number, documentIds: number[]) {
  const uniqueIds = Array.from(new Set(documentIds));
  const projectDocuments = await Promise.all(uniqueIds.map((id) => getDocumentById(id, projectId)));
  if (projectDocuments.some((document) => !document)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "One or more documents were not found in this project" });
  }
  return projectDocuments.filter((document): document is NonNullable<typeof document> => Boolean(document));
}

function withDocumentAccessUrl<
  T extends { id: number; projectId: number; storageUrl?: string | null },
>(document: T): T & { storageUrl: string } {
  return {
    ...document,
    storageUrl: documentAccessUrl(document.projectId, document.id),
  };
}

function withSampleAccessUrl<
  T extends { id: number; projectId: number; imageUrl?: string | null },
>(sample: T): T & { imageUrl: string } {
  return {
    ...sample,
    imageUrl: onboardingSampleAccessUrl(sample.projectId, sample.id),
  };
}

// ─── Auth Router ──────────────────────────────────────────────────────────────

const authRouter = router({
  me: publicProcedure.query(opts => opts.ctx.user),
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
});

// ─── Projects Router ──────────────────────────────────────────────────────────

const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const items = await getProjectsByUserId(ctx.user.id);
    if (!isVisualArchivesEnabled()) {
      return items.map(project => ({ ...project, archiveMode: "document_transcription" as const }));
    }
    const visualIds = await getVisualProjectIds(items.map(project => project.id));
    if (!isVisualArchivesPreviewUser(ctx.user)) {
      return items
        .filter(project => !visualIds.has(project.id))
        .map(project => ({ ...project, archiveMode: "document_transcription" as const }));
    }
    return items.map(project => ({
      ...project,
      archiveMode: visualIds.has(project.id) ? "visual_vra" as const : "document_transcription" as const,
    }));
  }),

  createDemo: protectedProcedure.mutation(async ({ ctx }) => {
    // Check if user already has a demo project
    const existing = await getProjectsByUserId(ctx.user.id);
    const hasDemo = existing.some(p => p.name?.includes("Demo"));
    if (hasDemo) {
      throw new TRPCError({ code: "CONFLICT", message: "You already have a demo project" });
    }
    const { projectId } = await seedDemoProject(ctx.user.id);
    return { projectId };
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const visualMode = isVisualArchivesEnabled() ? await getVisualProjectMode(project.id) : undefined;
      if (visualMode && !isVisualArchivesPreviewUser(ctx.user)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return {
        ...project,
        archiveMode: visualMode ? "visual_vra" as const : "document_transcription" as const,
      };
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await createProject({
        userId: ctx.user.id,
        name: input.name,
        description: input.description ?? null,
        status: "onboarding",
      });
      const projects = await getProjectsByUserId(ctx.user.id);
      return projects[0]; // most recent
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      systemPrompt: z.string().optional(),
      pass2Prompt: z.string().optional(),
      jsonSchema: z.record(z.string(), z.unknown()).optional(),
      glossary: z.record(z.string(), z.string()).optional(),
      postProcessing: z.array(z.unknown()).optional(),
      modelName: z.string().optional(),
      pipelineType: z.enum(["single_pass", "two_pass"]).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().min(256).max(32768).optional(),
      status: z.enum(["onboarding", "validating", "active", "archived"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.id, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot modify project settings" });
      const { id, ...data } = input;
      await updateProject(id, ctx.user.id, data as Parameters<typeof updateProject>[2]);
      return getProjectById(id, ctx.user.id);
    }),

  stats: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const stats = await getProjectStats(input.id, ctx.user.id);
      if (!stats) throw new TRPCError({ code: "NOT_FOUND" });
      return stats;
    }),

  /**
   * Generate a JSON schema for the project based on the current system prompt.
   * Returns a ready-to-use JSON object the user can paste into the schema field.
   */
  generateSchema: protectedProcedure
    .input(z.object({
      id: z.number(),
      systemPrompt: z.string().min(10).max(8000),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.id, ctx.user.id);
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an expert archival data modeller. Given a transcription system prompt, generate a JSON schema object that defines the fields the AI should extract from documents. Each key should be a field name (camelCase), and each value should be an object with: type ("string"|"number"|"boolean"|"array"), description (a short explanation), nullable (true/false), and optionally displayHint ("short_text"|"long_text"|"tag_list"). Return ONLY valid JSON, no markdown, no explanation.`,
          },
          {
            role: "user",
            content: `System prompt:\n${input.systemPrompt}\n\nGenerate the output JSON schema:`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM returned empty response" });

      try {
        const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
        return { schema: parsed };
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM returned invalid JSON" });
      }
    }),

  /**
   * Generate a domain glossary for the project based on the current system prompt.
   * Returns a flat key-value JSON object of domain terms and their definitions.
   */
  generateGlossary: protectedProcedure
    .input(z.object({
      id: z.number(),
      systemPrompt: z.string().min(10).max(8000),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.id, ctx.user.id);
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an expert in historical and archival linguistics. Given a transcription system prompt, generate a domain glossary as a flat JSON object where each key is a domain-specific term (e.g. an Arabic word, a technical term, an abbreviation) and each value is a short English definition or translation. Include 10-25 relevant terms. Return ONLY valid JSON, no markdown, no explanation.`,
          },
          {
            role: "user",
            content: `System prompt:\n${input.systemPrompt}\n\nGenerate the domain glossary:`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM returned empty response" });

      try {
        const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
        return { glossary: parsed };
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM returned invalid JSON" });
      }
    }),

  /**
   * Re-index all reviewed documents in a project.
   * Generates embeddings for all transcriptions with status reviewed/flagged that don't have embeddings yet.
   * Returns the count of documents that were indexed.
   */
  reindexAll: protectedProcedure
    .input(z.object({ id: z.number(), scope: z.enum(["reviewed", "all"]).default("reviewed") }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.id, ctx.user.id);
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Get documents without embeddings based on scope
      const docs = input.scope === "all"
        ? await getAllDocsWithoutEmbeddings(input.id)
        : await getReviewedDocsWithoutEmbeddings(input.id);

      // Generate embeddings in batches
      const batchSize = 5;
      let indexed = 0;

      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (doc) => {
            try {
              // Use reviewedJson if available, otherwise fall back to rawJson
              const jsonToEmbed = (doc.reviewedJson ?? doc.rawJson) as Record<string, unknown>;
              await embedTranscription({
                projectId: input.id,
                documentId: doc.documentId,
                transcriptionId: doc.transcriptionId,
                reviewedJson: jsonToEmbed,
                filename: doc.filename,
              });
              indexed++;
            } catch (err) {
              console.error(`Failed to index doc ${doc.documentId}:`, err);
            }
          })
        );
      }

      return { indexed };
    }),

  /**
   * Refine project configuration using natural language feedback.
   * Uses the onboarding agent to update system prompt, JSON schema, glossary, etc.
   * Works even if the project has no onboarding samples (uses config-only refinement).
   */
  refineWithAI: protectedProcedure
    .input(z.object({
      id: z.number(),
      feedback: z.string().min(1).max(4000),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.id, ctx.user.id);
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const currentConfig = {
        pipelineType: project.pipelineType as "single_pass" | "two_pass",
        modelName: project.modelName,
        systemPrompt: project.systemPrompt ?? "",
        pass2Prompt: project.pass2Prompt ?? undefined,
        jsonSchema: project.jsonSchema as Record<string, { type: "string" | "boolean" | "array" | "number"; description: string; nullable: boolean; displayHint?: "short_text" | "long_text" | "tag_list" }>,
        glossary: project.glossary as Record<string, string>,
        postProcessing: (project.postProcessing as Array<{ type: string; field: string; marker?: string; format?: string }>) ?? [],
        outputFormats: (project.outputFormats as string[]) ?? ["json", "csv"],
        reasoning: project.onboardingReasoning ?? "",
      };

      // Try to load onboarding samples for richer context; fall back to empty array
      let samplePairs: Array<{ imageBase64: string; mimeType: string; filename: string; manualTranscription: Record<string, unknown> }> = [];
      try {
        const samples = await getSamplesByProjectId(input.id);
        if (samples.length > 0) {
          const { storageGet: storageGetRefine } = await import("./storage");
          samplePairs = await Promise.all(
            samples.filter(s => !s.isHeldOut).slice(0, 3).map(async (s) => {
              const { url } = await storageGetRefine(s.imagePath);
              const base64 = (await fetchStorageObject(url)).toString("base64");
              return {
                imageBase64: base64,
                mimeType: "image/jpeg",
                filename: s.filename ?? "document.jpg",
                manualTranscription: s.manualTranscription as Record<string, unknown>,
              };
            })
          );
        }
      } catch {
        // Proceed without samples — the refine function works with config + feedback alone
      }

      const refined = await refineConfig(currentConfig, input.feedback, samplePairs);

      await updateProject(input.id, ctx.user.id, {
        systemPrompt: refined.systemPrompt,
        pass2Prompt: refined.pass2Prompt ?? null,
        jsonSchema: refined.jsonSchema,
        glossary: refined.glossary,
        postProcessing: refined.postProcessing,
        outputFormats: refined.outputFormats,
        modelName: refined.modelName,
        pipelineType: refined.pipelineType,
        onboardingReasoning: refined.reasoning,
      });

      return {
        config: refined,
        changes: refined.reasoning,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.id, ctx.user.id);
      if (role !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner can delete a project" });
      await deleteProject(input.id, ctx.user.id);
      return { deleted: true };
    }),
});

// ─── Onboarding Router ────────────────────────────────────────────────────────

const onboardingRouter = router({
  getSamples: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const samples = await getSamplesByProjectId(input.projectId);
      return samples.map(withSampleAccessUrl);
    }),

  uploadSample: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      filename: z.string(),
      imageBase64: z.string(),
      mimeType: z.string().default("image/jpeg"),
      manualTranscription: z.record(z.string(), z.unknown()),
      isHeldOut: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Store image to S3
      const imageBuffer = Buffer.from(input.imageBase64, "base64");
      const key = `projects/${input.projectId}/samples/${Date.now()}-${input.filename}`;
      await storagePut(key, imageBuffer, input.mimeType ?? "image/jpeg");

      const sample = await createOnboardingSample({
        projectId: input.projectId,
        imagePath: key,
        imageUrl: null,
        filename: input.filename,
        manualTranscription: input.manualTranscription,
        isHeldOut: input.isHeldOut,
      });

      return {
        success: true,
        imageUrl: onboardingSampleAccessUrl(input.projectId, sample.id),
      };
    }),

  generateConfig: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const samples = await getSamplesByProjectId(input.projectId);
      if (samples.length < 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Upload at least 1 sample before generating config." });
      }

      // Prepare sample pairs for the onboarding agent
      const samplePairs = await Promise.all(
        samples.filter(s => !s.isHeldOut).map(async (s) => {
          // Re-fetch image from storage for the AI call
          const { storageGet } = await import("./storage");
          const { url } = await storageGet(s.imagePath);
          // Fetch the image bytes and re-encode
          const base64 = (await fetchStorageObject(url)).toString("base64");
          return {
            imageBase64: base64,
            mimeType: "image/jpeg",
            filename: s.filename ?? "document.jpg",
            manualTranscription: s.manualTranscription as Record<string, unknown>,
          };
        })
      );

      const config = await generateProjectConfig(samplePairs);

      // Save config to project
      await updateProject(input.projectId, ctx.user.id, {
        systemPrompt: config.systemPrompt,
        pass2Prompt: config.pass2Prompt ?? null,
        jsonSchema: config.jsonSchema,
        glossary: config.glossary,
        postProcessing: config.postProcessing,
        outputFormats: config.outputFormats,
        modelName: config.modelName,
        pipelineType: config.pipelineType,
        onboardingReasoning: config.reasoning,
        status: "validating",
      });

      return config;
    }),

  validate: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      if (!project.systemPrompt) throw new TRPCError({ code: "BAD_REQUEST", message: "Generate config first." });

      const samples = await getSamplesByProjectId(input.projectId);
      const heldOut = samples.find(s => s.isHeldOut) ?? samples[samples.length - 1];
      if (!heldOut) throw new TRPCError({ code: "BAD_REQUEST", message: "No samples found." });

      // Fetch held-out image
      const { storageGet: storageGetValidate } = await import("./storage");
      const { url } = await storageGetValidate(heldOut.imagePath);
      const base64 = (await fetchStorageObject(url)).toString("base64");

      const config = {
        pipelineType: project.pipelineType as "single_pass" | "two_pass",
        modelName: project.modelName,
        systemPrompt: project.systemPrompt,
        pass2Prompt: project.pass2Prompt ?? undefined,
        jsonSchema: project.jsonSchema as Record<string, { type: "string" | "boolean" | "array" | "number"; description: string; nullable: boolean; displayHint?: "short_text" | "long_text" | "tag_list" }>,
        glossary: project.glossary as Record<string, string>,
        postProcessing: (project.postProcessing as Array<{ type: string; field: string; marker?: string; format?: string }>) ?? [],
        outputFormats: (project.outputFormats as string[]) ?? ["json", "csv"],
        reasoning: project.onboardingReasoning ?? "",
      };

      const result = await validateConfig(config, {
        imageBase64: base64,
        mimeType: "image/jpeg",
        filename: heldOut.filename ?? "document.jpg",
        manualTranscription: heldOut.manualTranscription as Record<string, unknown>,
      });

      // Save validation results
      await updateSampleAiOutput(heldOut.id, input.projectId, result.aiOutput, result.score);

      return result;
    }),

  refine: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      feedback: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const samples = await getSamplesByProjectId(input.projectId);
      const samplePairs = await Promise.all(
        samples.filter(s => !s.isHeldOut).map(async (s) => {
          const { storageGet: storageGetRefine } = await import("./storage");
          const { url } = await storageGetRefine(s.imagePath);
          const base64 = (await fetchStorageObject(url)).toString("base64");
          return {
            imageBase64: base64,
            mimeType: "image/jpeg",
            filename: s.filename ?? "document.jpg",
            manualTranscription: s.manualTranscription as Record<string, unknown>,
          };
        })
      );

      const currentConfig = {
        pipelineType: project.pipelineType as "single_pass" | "two_pass",
        modelName: project.modelName,
        systemPrompt: project.systemPrompt ?? "",
        pass2Prompt: project.pass2Prompt ?? undefined,
        jsonSchema: project.jsonSchema as Record<string, { type: "string" | "boolean" | "array" | "number"; description: string; nullable: boolean; displayHint?: "short_text" | "long_text" | "tag_list" }>,
        glossary: project.glossary as Record<string, string>,
        postProcessing: (project.postProcessing as Array<{ type: string; field: string; marker?: string; format?: string }>) ?? [],
        outputFormats: (project.outputFormats as string[]) ?? ["json", "csv"],
        reasoning: project.onboardingReasoning ?? "",
      };

      const refined = await refineConfig(currentConfig, input.feedback, samplePairs);

      await updateProject(input.projectId, ctx.user.id, {
        systemPrompt: refined.systemPrompt,
        pass2Prompt: refined.pass2Prompt ?? null,
        jsonSchema: refined.jsonSchema,
        glossary: refined.glossary,
        postProcessing: refined.postProcessing,
        outputFormats: refined.outputFormats,
        modelName: refined.modelName,
        pipelineType: refined.pipelineType,
        onboardingReasoning: refined.reasoning,
      });

      return refined;
    }),

  activate: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await updateProject(input.projectId, ctx.user.id, { status: "active" });
      return { success: true };
    }),

  // ─── Conversational Onboarding Chat ───────────────────────────────────────

  chat: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        imageUrls: z.array(z.string()).optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const response = await processOnboardingChat(
        input.messages as ChatMessage[],
        project.name ?? undefined,
      );

      const configReady = response.includes("[CONFIG_READY]");
      const cleanResponse = response.replace("[CONFIG_READY]", "").trim();

      return { response: cleanResponse, configReady };
    }),

  chatUploadImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      filename: z.string(),
      imageBase64: z.string(),
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const imageBuffer = Buffer.from(input.imageBase64, "base64");
      const key = `projects/${input.projectId}/onboarding-chat/${Date.now()}-${input.filename}`;
      await storagePut(key, imageBuffer, input.mimeType ?? "image/jpeg");

      return { imageUrl: `data:${input.mimeType};base64,${input.imageBase64}` };
    }),

  generateFromChat: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        imageUrls: z.array(z.string()).optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const config = await generateConfigFromChat(input.messages as ChatMessage[]);

      // Save config to project
      await updateProject(input.projectId, ctx.user.id, {
        systemPrompt: config.systemPrompt,
        pass2Prompt: config.pass2Prompt ?? null,
        jsonSchema: config.jsonSchema,
        glossary: config.glossary,
        postProcessing: config.postProcessing,
        outputFormats: config.outputFormats,
        modelName: config.modelName,
        pipelineType: config.pipelineType,
        onboardingReasoning: config.reasoning,
        status: "active",
      });

      return config;
    }),
});

// ─── Documents Router ─────────────────────────────────────────────────────────

const documentsRouter = router({
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      status: z.enum(["pending", "processing", "needs_review", "reviewed", "flagged", "error"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const documents = await getDocumentsByProjectId(input.projectId, input.status);
      return documents.map(withDocumentAccessUrl);
    }),

  listPaginated: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      status: z.enum(["pending", "processing", "needs_review", "reviewed", "flagged", "error"]).optional(),
      search: z.string().optional(),
      language: z.string().optional(),
      cursor: z.number().optional(),
      limit: z.number().min(1).max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const page = await getDocumentsPaginated({
        projectId: input.projectId,
        status: input.status,
        search: input.search,
        language: input.language,
        cursor: input.cursor,
        limit: input.limit,
      });
      return {
        ...page,
        documents: page.documents.map(withDocumentAccessUrl),
      };
    }),

  // Get distinct languages found in project transcriptions
  getLanguages: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return getProjectLanguages(input.projectId);
    }),

  // Returns a fresh presigned URL for viewing a document image (stored URLs expire)
  getImageUrl: protectedProcedure
    .input(z.object({ documentId: z.number(), projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const doc = await getDocumentById(input.documentId, input.projectId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        url: documentAccessUrl(input.projectId, input.documentId),
        filename: doc.filename,
        mimeType: doc.mimeType,
      };
    }),

  upload: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      filename: z.string(),
      fileBase64: z.string().max(15_000_000),
      mimeType: z.string().default("image/jpeg"),
      fileSizeBytes: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot upload documents" });
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      if (project.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Project must be active to upload documents." });
      }

      // Charge the project owner's allowance so editors cannot bypass the
      // project owner's usage cap. Owner/admin accounts remain exempt.
      const quota = await reserveDocumentQuotaSlot(project.userId);
      if (!quota.allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `This account has reached the ${quota.documentLimit}-document free-tier limit. Paid upgrades are not available yet.`,
        });
      }

      try {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const key = `projects/${input.projectId}/documents/${Date.now()}-${input.filename}`;
        await storagePut(key, buffer, input.mimeType ?? "image/jpeg");

        await createDocument({
          projectId: input.projectId,
          filename: input.filename,
          storagePath: key,
          storageUrl: null,
          mimeType: input.mimeType,
          fileSizeBytes: input.fileSizeBytes ?? null,
          status: "pending",
        });
      } catch (error) {
        if (quota.quotaReserved) {
          await releaseDocumentQuotaSlot(project.userId).catch((releaseError) => {
            console.error("[Billing] Failed to release document quota after upload error", releaseError);
          });
        }
        throw error;
      }

      const docs = await getDocumentsByProjectId(input.projectId);
      // Log activity
      logActivity({ projectId: input.projectId, userId: ctx.user.id, action: "document_uploaded", metadata: { filename: input.filename } }).catch(() => {});
      return { ...withDocumentAccessUrl(docs[0]), usage: quota };
    }),

  transcribe: protectedProcedure
    .input(z.object({
      documentId: z.number(),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const doc = await getDocumentById(input.documentId, input.projectId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      // Mark as processing
      await updateDocumentStatus(input.documentId, input.projectId, "processing");

      try {
        // Fetch image from storage
        const { storageGet: storageGetDoc } = await import("./storage");
        const { url } = await storageGetDoc(doc.storagePath);
        const base64 = (await fetchStorageObject(url)).toString("base64");

        const result = await processDocument(project, base64, doc.mimeType ?? "image/jpeg", doc.filename);

        if (result.error) {
          await updateDocumentStatus(input.documentId, input.projectId, "error", result.error);
          return { success: false, error: result.error };
        }

        await createTranscription({
          documentId: input.documentId,
          projectId: input.projectId,
          modelUsed: result.modelUsed,
          rawJson: result.rawJson,
          originalText: result.originalText ?? null,
        });

        await updateDocumentStatus(input.documentId, input.projectId, "needs_review");
        // Log activity
        logActivity({ projectId: input.projectId, userId: ctx.user.id, action: "document_transcribed", metadata: { documentId: input.documentId } }).catch(() => {});
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await updateDocumentStatus(input.documentId, input.projectId, "error", msg);
        return { success: false, error: msg };
      }
    }),

  crossCheck: protectedProcedure
    .input(z.object({
      documentId: z.number(),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const doc = await getDocumentById(input.documentId, input.projectId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      const transcription = await getTranscriptionByDocumentId(input.documentId, input.projectId);
      if (!transcription) throw new TRPCError({ code: "NOT_FOUND", message: "No transcription found to verify" });
      try {
        const { storageGet: storageGetDoc } = await import("./storage");
        const { url } = await storageGetDoc(doc.storagePath);
        const base64 = (await fetchStorageObject(url)).toString("base64");
        const existingJson = (transcription.reviewedJson ?? transcription.rawJson) as Record<string, unknown>;
        const result = await crossCheckTranscription(project, base64, doc.mimeType ?? "image/jpeg", existingJson);
        logActivity({ projectId: input.projectId, userId: ctx.user.id, action: "document_cross_checked", metadata: { documentId: input.documentId, assessment: result.overallAssessment } }).catch(() => {});
        return { success: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    }),

  batchTranscribe: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const pendingDocs = await getDocumentsByProjectId(input.projectId, "pending");
      if (pendingDocs.length === 0) {
        return { queued: 0, message: "No pending documents." };
      }

      // Create a batch job record
      await createJob({
        projectId: input.projectId,
        type: "batch_transcribe",
        status: "queued",
        totalItems: pendingDocs.length,
        completedItems: 0,
        metadata: { documentIds: pendingDocs.map(d => d.id) },
      });

      // Process in background (fire and forget with concurrency limit)
      const CONCURRENCY = 5;
      (async () => {
        const jobs_list = await getJobsByProjectId(input.projectId);
        const job = jobs_list[0];
        if (!job) return;

        await updateJob(job.id, { status: "running" });

        let completed = 0;
        const chunks: typeof pendingDocs[] = [];
        for (let i = 0; i < pendingDocs.length; i += CONCURRENCY) {
          chunks.push(pendingDocs.slice(i, i + CONCURRENCY));
        }

        for (const chunk of chunks) {
          await Promise.all(chunk.map(async (doc) => {
            try {
              await updateDocumentStatus(doc.id, input.projectId, "processing");
              const { storageGet: storageGetBatch } = await import("./storage");
              const { url } = await storageGetBatch(doc.storagePath);
              
              // Retry up to 3 times with exponential backoff
              let lastError: string | null = null;
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  const base64 = (await fetchStorageObject(url)).toString("base64");
                  const result = await processDocument(project, base64, doc.mimeType ?? "image/jpeg", doc.filename);

                  if (result.error) {
                    // If it's a rate limit or transient error, retry
                    if (attempt < 2 && (result.error.includes("429") || result.error.includes("fetch failed") || result.error.includes("RESOURCE_EXHAUSTED"))) {
                      lastError = result.error;
                      await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
                      continue;
                    }
                    await updateDocumentStatus(doc.id, input.projectId, "error", result.error);
                  } else {
                    await createTranscription({
                      documentId: doc.id,
                      projectId: input.projectId,
                      modelUsed: result.modelUsed,
                      rawJson: result.rawJson,
                      originalText: result.originalText ?? null,
                    });
                    await updateDocumentStatus(doc.id, input.projectId, "needs_review");
                  }
                  lastError = null;
                  break; // Success, exit retry loop
                } catch (fetchErr) {
                  lastError = String(fetchErr);
                  if (attempt < 2) {
                    console.log(`[Batch] Doc ${doc.id} attempt ${attempt + 1} failed: ${lastError}, retrying in ${(attempt + 1) * 5}s...`);
                    await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
                  }
                }
              }
              if (lastError) {
                await updateDocumentStatus(doc.id, input.projectId, "error", `Failed after 3 attempts: ${lastError}`);
              }
            } catch (err) {
              await updateDocumentStatus(doc.id, input.projectId, "error", String(err));
            }
            completed++;
          }));
          // Small delay between chunks to avoid rate limiting
          if (chunks.indexOf(chunk) < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
          }
          await updateJob(job.id, {
            completedItems: completed,
            progress: Math.round((completed / pendingDocs.length) * 100),
          });
        }

        await updateJob(job.id, { status: "completed", progress: 100, completedItems: pendingDocs.length });
      })().catch(console.error);

      return { queued: pendingDocs.length, message: `Queued ${pendingDocs.length} documents for transcription.` };
    }),

  retryAllPending: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Reset stuck 'processing' docs and get all retryable docs via db helper
      const { resetStuckAndGetRetryable } = await import("./db");
      const retryDocs = await resetStuckAndGetRetryable(input.projectId);

      if (retryDocs.length === 0) {
        return { queued: 0, message: "No documents to retry." };
      }

      // Process in background with concurrency limit
      const CONCURRENCY = 5;
      (async () => {
        const chunks: typeof retryDocs[] = [];
        for (let i = 0; i < retryDocs.length; i += CONCURRENCY) {
          chunks.push(retryDocs.slice(i, i + CONCURRENCY));
        }

        for (const chunk of chunks) {
          await Promise.all(chunk.map(async (doc) => {
            try {
              await updateDocumentStatus(doc.id, input.projectId, "processing");
              const { storageGet: storageGetRetry } = await import("./storage");
              const { url } = await storageGetRetry(doc.storagePath);

              let lastError: string | null = null;
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  const base64 = (await fetchStorageObject(url)).toString("base64");
                  const result = await processDocument(project, base64, doc.mimeType ?? "image/jpeg", doc.filename);

                  if (result.error) {
                    if (attempt < 2 && (result.error.includes("429") || result.error.includes("fetch failed") || result.error.includes("RESOURCE_EXHAUSTED"))) {
                      lastError = result.error;
                      await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
                      continue;
                    }
                    await updateDocumentStatus(doc.id, input.projectId, "error", result.error);
                  } else {
                    await createTranscription({
                      documentId: doc.id,
                      projectId: input.projectId,
                      modelUsed: result.modelUsed,
                      rawJson: result.rawJson,
                      originalText: result.originalText ?? null,
                    });
                    await updateDocumentStatus(doc.id, input.projectId, "needs_review");
                  }
                  lastError = null;
                  break;
                } catch (fetchErr) {
                  lastError = String(fetchErr);
                  if (attempt < 2) {
                    console.log(`[Retry] Doc ${doc.id} attempt ${attempt + 1} failed: ${lastError}, retrying in ${(attempt + 1) * 5}s...`);
                    await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
                  }
                }
              }
              if (lastError) {
                await updateDocumentStatus(doc.id, input.projectId, "error", `Failed after 3 attempts: ${lastError}`);
              }
            } catch (err) {
              await updateDocumentStatus(doc.id, input.projectId, "error", String(err));
            }
          }));
          // Delay between chunks to avoid rate limiting
          if (chunks.indexOf(chunk) < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      })().catch(console.error);

      return { queued: retryDocs.length, message: `Retrying ${retryDocs.length} document(s).` };
    }),

  delete: protectedProcedure
    .input(z.object({ documentId: z.number(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot delete documents" });
      const doc = await getDocumentById(input.documentId, input.projectId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      await deleteDocument(input.documentId, input.projectId);
      return { success: true };
    }),

  rename: protectedProcedure
    .input(z.object({ documentId: z.number(), projectId: z.number(), newFilename: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot rename documents" });
      const doc = await getDocumentById(input.documentId, input.projectId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      await renameDocument(input.documentId, input.projectId, input.newFilename);
      return { success: true, filename: input.newFilename };
    }),

  changeStatus: protectedProcedure
    .input(z.object({
      documentId: z.number(),
      projectId: z.number(),
      status: z.enum(["pending", "processing", "needs_review", "reviewed", "flagged", "error"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot change document status" });
      const doc = await getDocumentById(input.documentId, input.projectId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      await updateDocumentStatus(input.documentId, input.projectId, input.status);
      return { success: true, status: input.status };
    }),
  bulkChangeStatus: protectedProcedure
    .input(z.object({
      documentIds: z.array(z.number()),
      projectId: z.number(),
      status: z.enum(["pending", "processing", "needs_review", "reviewed", "flagged", "error"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot change document status" });
      await requireProjectDocuments(input.projectId, input.documentIds);
      for (const docId of input.documentIds) {
        await updateDocumentStatus(docId, input.projectId, input.status);
      }
      return { success: true, count: input.documentIds.length };
    }),
  bulkDelete: protectedProcedure
    .input(z.object({
      documentIds: z.array(z.number()),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot delete documents" });
      await requireProjectDocuments(input.projectId, input.documentIds);
      for (const docId of input.documentIds) {
        await deleteDocument(docId, input.projectId);
      }
      return { success: true, count: input.documentIds.length };
    }),
});

// ─── Transcriptions Router ────────────────────────────────────────────────────

const transcriptionsRouter = router({
  getByDocument: protectedProcedure
    .input(z.object({ documentId: z.number(), projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const document = await getDocumentById(input.documentId, input.projectId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      return getTranscriptionByDocumentId(input.documentId, input.projectId);
    }),

  saveReview: protectedProcedure
    .input(z.object({
      transcriptionId: z.number(),
      documentId: z.number(),
      projectId: z.number(),
      reviewedJson: z.record(z.string(), z.unknown()),
      status: z.enum(["reviewed", "flagged"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "Viewers cannot review documents" });
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const transcription = await getTranscriptionByDocumentId(input.documentId, input.projectId);
      if (!transcription || transcription.id !== input.transcriptionId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transcription not found" });
      }
      await updateReviewedJson(input.transcriptionId, input.documentId, input.projectId, input.reviewedJson);
      await updateDocumentStatus(input.documentId, input.projectId, input.status);

      // Log activity
      const actAction = input.status === "flagged" ? "document_flagged" as const : "document_reviewed" as const;
      logActivity({ projectId: input.projectId, userId: ctx.user.id, action: actAction, metadata: { documentId: input.documentId } }).catch(() => {});

      // Fire-and-forget: generate embedding for semantic search
      const doc = await getDocumentById(input.documentId, input.projectId);
      if (doc) {
        embedTranscription({
          projectId: input.projectId,
          documentId: input.documentId,
          transcriptionId: input.transcriptionId,
          reviewedJson: input.reviewedJson as Record<string, unknown>,
          filename: doc.filename,
        }).catch((err) => console.warn("[Embedding] Failed:", err));
      }

      // Fire-and-forget: reconcile entities — remove stale ones and re-extract from updated text
      const textForNER = Object.values(input.reviewedJson)
        .filter((v): v is string => typeof v === "string")
        .join("\n");
      if (textForNER.length > 10) {
        reconcileDocumentEntities(input.projectId, input.documentId, textForNER)
          .catch((err) => console.warn("[NER-Reconcile] Failed:", err));
      }

      // Fire-and-forget: sync entity name edits from transcription fields
      // If the user edited a field that contains an entity name (e.g., sender, recipient),
      // and the document has linked entities, update the entity record to match.
      (async () => {
        try {
          const { getDb } = await import("./db");
          const { documentEntities: docEntTable, entities: entTable } = await import("../drizzle/schema");
          const { eq, and, sql: sqlHelper } = await import("drizzle-orm");
          const dbConn = (await getDb())!;

          // Get entities linked to this document
          const linkedEntities = await dbConn
            .select({ entityId: docEntTable.entityId, contextSnippet: docEntTable.contextSnippet })
            .from(docEntTable)
            .where(and(
              eq(docEntTable.documentId, input.documentId),
              eq(docEntTable.projectId, input.projectId),
            ));

          if (linkedEntities.length === 0) return;

          // Get the actual entity records
          const entityIds = linkedEntities.map(le => le.entityId);
          const entityRecords = await dbConn
            .select({ id: entTable.id, name: entTable.name, type: entTable.type, canonicalId: entTable.canonicalId })
            .from(entTable)
            .where(and(
              eq(entTable.projectId, input.projectId),
              sqlHelper`${entTable.id} IN (${sqlHelper.raw(entityIds.join(","))})`
            ));

          // Check entity-related fields in the reviewed JSON (sender, recipient, creator, mentioned_entities)
          const entityFields = ["sender", "recipient", "creator", "author"];
          for (const field of entityFields) {
            const newValue = input.reviewedJson[field];
            if (typeof newValue !== "string" || !newValue.trim()) continue;

            // Find if there's a person entity whose name was close to the old value
            // and update it to the new value
            const normalizedNew = newValue.trim().toLowerCase();
            for (const entity of entityRecords) {
              if (entity.canonicalId) continue; // skip merged entities
              if (entity.type !== "person") continue;
              // Check if the entity name is similar to the field value (fuzzy match)
              const normalizedEntity = entity.name.toLowerCase();
              // If the entity name appears in the field value or vice versa, sync it
              if (normalizedEntity.includes(normalizedNew) || normalizedNew.includes(normalizedEntity)) {
                if (entity.name !== newValue.trim()) {
                  await dbConn
                    .update(entTable)
                    .set({ name: newValue.trim(), normalizedName: normalizedNew })
                    .where(and(eq(entTable.id, entity.id), eq(entTable.projectId, input.projectId)));
                  console.log(`[EntitySync] Updated entity #${entity.id} name: "${entity.name}" → "${newValue.trim()}"`);
                }
                break; // Only update one entity per field
              }
            }
          }

          // Also handle mentioned_entities array field
          const mentionedEntities = input.reviewedJson["mentioned_entities"];
          if (Array.isArray(mentionedEntities)) {
            for (const mention of mentionedEntities) {
              if (typeof mention !== "string" || !mention.trim()) continue;
              const normalizedMention = mention.trim().toLowerCase();
              for (const entity of entityRecords) {
                if (entity.canonicalId) continue;
                const normalizedEntity = entity.name.toLowerCase();
                if (normalizedEntity === normalizedMention && entity.name !== mention.trim()) {
                  await dbConn
                    .update(entTable)
                    .set({ name: mention.trim(), normalizedName: normalizedMention })
                    .where(and(eq(entTable.id, entity.id), eq(entTable.projectId, input.projectId)));
                  console.log(`[EntitySync] Updated entity #${entity.id} from mentioned_entities: "${entity.name}" → "${mention.trim()}"`);
                  break;
                }
              }
            }
          }
        } catch (err) {
          console.warn("[EntitySync] Failed:", err);
        }
      })();

      return { success: true };
    }),

  // Recursive field propagation — find all documents with oldValue and replace with newValue
  propagateFieldCorrection: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fieldKey: z.string(),
      oldValue: z.string(),
      newValue: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });

      const { getDb } = await import("./db");
      const { transcriptions: transcriptionsTable, documents: documentsTable } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const dbConn = (await getDb())!;

      // Find all transcriptions in this project
      const allTranscriptions = await dbConn
        .select({ id: transcriptionsTable.id, reviewedJson: transcriptionsTable.reviewedJson, rawJson: transcriptionsTable.rawJson, documentId: transcriptionsTable.documentId })
        .from(transcriptionsTable)
        .innerJoin(documentsTable, eq(documentsTable.id, transcriptionsTable.documentId))
        .where(and(
          eq(documentsTable.projectId, input.projectId),
          eq(transcriptionsTable.projectId, input.projectId),
        ));

      let updatedCount = 0;
      for (const t of allTranscriptions) {
        const json = (t.reviewedJson ?? t.rawJson) as Record<string, unknown> | null;
        if (!json) continue;
        const fieldValue = json[input.fieldKey];
        if (fieldValue === undefined) continue;

        let needsUpdate = false;
        let newFieldValue: unknown = fieldValue;

        if (typeof fieldValue === "string" && fieldValue.includes(input.oldValue)) {
          newFieldValue = fieldValue.replaceAll(input.oldValue, input.newValue);
          needsUpdate = true;
        } else if (Array.isArray(fieldValue)) {
          const newArr = fieldValue.map(item =>
            typeof item === "string" && item.includes(input.oldValue)
              ? item.replaceAll(input.oldValue, input.newValue)
              : item
          );
          if (JSON.stringify(newArr) !== JSON.stringify(fieldValue)) {
            newFieldValue = newArr;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          const updatedJson = { ...json, [input.fieldKey]: newFieldValue };
          await dbConn
            .update(transcriptionsTable)
            .set({ reviewedJson: updatedJson })
            .where(and(
              eq(transcriptionsTable.id, t.id),
              eq(transcriptionsTable.projectId, input.projectId),
              eq(transcriptionsTable.documentId, t.documentId),
            ));
          updatedCount++;
        }
      }

      return { success: true, updatedCount };
    }),

  // Count how many documents would be affected by a field propagation
  countPropagationTargets: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fieldKey: z.string(),
      oldValue: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });

      const { getDb } = await import("./db");
      const { transcriptions: transcriptionsTable, documents: documentsTable } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const dbConn = (await getDb())!;

      const allTranscriptions = await dbConn
        .select({ reviewedJson: transcriptionsTable.reviewedJson, rawJson: transcriptionsTable.rawJson })
        .from(transcriptionsTable)
        .innerJoin(documentsTable, eq(documentsTable.id, transcriptionsTable.documentId))
        .where(eq(documentsTable.projectId, input.projectId));

      let count = 0;
      for (const t of allTranscriptions) {
        const json = (t.reviewedJson ?? t.rawJson) as Record<string, unknown> | null;
        if (!json) continue;
        const fieldValue = json[input.fieldKey];
        if (typeof fieldValue === "string" && fieldValue.includes(input.oldValue)) {
          count++;
        } else if (Array.isArray(fieldValue) && fieldValue.some(item => typeof item === "string" && item.includes(input.oldValue))) {
          count++;
        }
      }

      return { count };
    }),
});

// ─── RAG / Semantic Chat Router ───────────────────────────────────────────────

const ragRouter = router({
  /**
   * Semantic search: returns the top-k most similar reviewed documents.
   * Strictly scoped to the calling user's project.
   */
  search: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      query: z.string().min(1).max(2000),
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const results = await semanticSearch(input.projectId, input.query, input.limit);
      return results;
    }),

  /**
   * RAG chat: answers a question using the project's reviewed transcriptions.
   * Retrieves the top-5 most relevant documents, then calls the LLM with
   * the retrieved context to generate a grounded answer.
   */
  chat: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      question: z.string().min(1).max(4000),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Retrieve relevant documents via semantic search
      const hits = await semanticSearch(input.projectId, input.question, 5);

      if (hits.length === 0) {
        return {
          answer: "No reviewed documents found in this project yet. Please transcribe and review some documents first, then I can answer questions about them.",
          sources: [],
        };
      }

      // Build context block from retrieved documents
      const contextBlock = hits
        .map((h, i) => `[Document ${i + 1}]\n${h.content}`)
        .join("\n\n---\n\n");

      const systemPrompt = `You are an expert research assistant for the archival project "${project.name}".
You answer questions using ONLY the document excerpts provided below.
If the answer is not in the documents, say so clearly.
Always cite which document(s) you used by referencing [Document N].
Be concise, accurate, and scholarly.

=== RETRIEVED DOCUMENTS ===
${contextBlock}
=== END OF DOCUMENTS ===`;

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...input.history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
        { role: "user", content: input.question },
      ];

      const response = await invokeLLM({ messages });
      const answer = response.choices[0]?.message?.content ?? "I could not generate a response.";

      // Build source citations
      const sources = hits.map((h, i) => ({
        index: i + 1,
        documentId: h.documentId,
        filename: (h.metadata as Record<string, unknown>)?.filename as string ?? `Document ${h.documentId}`,
        similarity: Math.round(h.similarity * 100) / 100,
        excerpt: h.content.slice(0, 200) + (h.content.length > 200 ? "..." : ""),
      }));

      return { answer, sources };
    }),
});

// ─── Export Router ────────────────────────────────────────────────────────────

const exportRouter = router({
  csv: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      includeAll: z.boolean().default(false),
      documentIds: z.array(z.number()).optional(),
      statusFilter: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      let docs;
      if (input.documentIds && input.documentIds.length > 0) {
        docs = await getTranscriptionsByDocumentIds(input.projectId, input.documentIds);
      } else if (input.statusFilter) {
        docs = await getTranscriptionsByStatus(input.projectId, input.statusFilter);
      } else {
        docs = input.includeAll
          ? await getAllTranscriptions(input.projectId)
          : await getReviewedTranscriptions(input.projectId);
      }
      if (docs.length === 0) return { csv: "", count: 0 };

      const schema = project.jsonSchema as Record<string, { type: string }> | null;
      const schemaFields = schema ? Object.keys(schema) : [];
      const headers = ["filename", "status", "reviewed_at", "model_used", ...schemaFields];

      const rows = docs.map(({ transcription, document }) => {
        const data = (transcription.reviewedJson ?? transcription.rawJson) as Record<string, unknown>;
        const row: Record<string, string> = {
          filename: document.filename,
          status: document.status,
          reviewed_at: transcription.reviewedAt?.toISOString() ?? "",
          model_used: transcription.modelUsed,
        };
        for (const field of schemaFields) {
          const val = data?.[field];
          row[field] = Array.isArray(val) ? val.join(" | ") : String(val ?? "");
        }
        return row;
      });

      const csvLines = [
        headers.join(","),
        ...rows.map(r => headers.map(h => `"${(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
      ];

      return { csv: csvLines.join("\n"), count: docs.length };
    }),

  jsonZip: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      includeAll: z.boolean().default(false),
      documentIds: z.array(z.number()).optional(),
      statusFilter: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      let docs;
      if (input.documentIds && input.documentIds.length > 0) {
        docs = await getTranscriptionsByDocumentIds(input.projectId, input.documentIds);
      } else if (input.statusFilter) {
        docs = await getTranscriptionsByStatus(input.projectId, input.statusFilter);
      } else {
        docs = input.includeAll
          ? await getAllTranscriptions(input.projectId)
          : await getReviewedTranscriptions(input.projectId);
      }
      return docs.map(({ transcription, document }) => ({
        filename: document.filename.replace(/\.[^.]+$/, "") + ".json",
        data: transcription.reviewedJson ?? transcription.rawJson,
      }));
    }),

  /** Full TEI-XML corpus export — each document as a proper TEI element with inline entity markup */
  teiXmlCorpus: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      includeAll: z.boolean().default(false),
      documentIds: z.array(z.number()).optional(),
      statusFilter: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const { getEntitiesByProject, getDb } = await import("./db");
      const { documentEntities, entities } = await import("../drizzle/schema");
      const { eq, inArray } = await import("drizzle-orm");

      let docs;
      if (input.documentIds && input.documentIds.length > 0) {
        docs = await getTranscriptionsByDocumentIds(input.projectId, input.documentIds);
      } else if (input.statusFilter) {
        docs = await getTranscriptionsByStatus(input.projectId, input.statusFilter);
      } else {
        docs = input.includeAll
          ? await getAllTranscriptions(input.projectId)
          : await getReviewedTranscriptions(input.projectId);
      }

      // Get all entities for inline markup
      const allEntities = await getEntitiesByProject(input.projectId);
      const entityMap = new Map(allEntities.map(e => [e.id, e]));

      // Get document-entity links for inline tagging
      const db = (await getDb())!;
      const docIds = docs.map(d => d.document.id);
      const docEntityLinks = docIds.length > 0 ? await db
        .select({
          documentId: documentEntities.documentId,
          entityId: documentEntities.entityId,
          contextSnippet: documentEntities.contextSnippet,
        })
        .from(documentEntities)
        .where(eq(documentEntities.projectId, input.projectId)) : [];

      // Group entity links by document
      const entitiesByDoc = new Map<number, Array<{ entityId: number; contextSnippet: string | null }>>();
      for (const link of docEntityLinks) {
        if (!entitiesByDoc.has(link.documentId)) entitiesByDoc.set(link.documentId, []);
        entitiesByDoc.get(link.documentId)!.push(link);
      }

      const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const teiTagForType = (type: string) => {
        switch (type) {
          case "person": return "persName";
          case "location": return "placeName";
          case "organization": return "orgName";
          default: return "name";
        }
      };

      // Helper: attempt to tag entity names inline within text
      const tagEntitiesInText = (text: string, docEntities: Array<{ entityId: number; contextSnippet: string | null }>) => {
        if (!docEntities.length) return escXml(text);
        // Sort entities by name length (longest first) to avoid partial matches
        const entsToTag = docEntities
          .map(de => entityMap.get(de.entityId))
          .filter((e): e is NonNullable<typeof e> => !!e)
          .sort((a, b) => b.name.length - a.name.length);

        let result = text;
        const replacements: Array<{ start: number; end: number; replacement: string }> = [];

        for (const ent of entsToTag) {
          const tag = teiTagForType(ent.type);
          // Find all occurrences of entity name in text (case-insensitive)
          const regex = new RegExp(ent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
          let match;
          while ((match = regex.exec(text)) !== null) {
            // Check no overlap with existing replacements
            const start = match.index;
            const end = start + match[0].length;
            const overlaps = replacements.some(r => (start < r.end && end > r.start));
            if (!overlaps) {
              replacements.push({
                start,
                end,
                replacement: `<${tag} ref="#ent_${ent.id}">${escXml(match[0])}</${tag}>`,
              });
            }
          }
        }

        // Apply replacements from end to start to preserve indices
        replacements.sort((a, b) => b.start - a.start);
        for (const r of replacements) {
          result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
        }

        // Escape any remaining untagged text segments
        // Since we already inserted XML tags, we need a different approach:
        // Re-build by escaping only the non-tagged parts
        return result.replace(/&(?!amp;|lt;|gt;|quot;)/g, "&amp;").replace(/<(?!\/?(persName|placeName|orgName|name)[ >])/g, "&lt;");
      };

      // Build TEI-XML corpus
      const lines: string[] = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<teiCorpus xmlns="http://www.tei-c.org/ns/1.0">`,
        `  <teiHeader>`,
        `    <fileDesc>`,
        `      <titleStmt>`,
        `        <title>${escXml(project.name)}</title>`,
        `      </titleStmt>`,
        `      <publicationStmt>`,
        `        <p>Exported from TURATH on ${new Date().toISOString().split("T")[0]}</p>`,
        `      </publicationStmt>`,
        `      <sourceDesc>`,
        `        <p>${docs.length} documents from project "${escXml(project.name)}"</p>`,
        `      </sourceDesc>`,
        `    </fileDesc>`,
        `  </teiHeader>`,
      ];

      for (const { transcription, document } of docs) {
        const json = (transcription.reviewedJson ?? transcription.rawJson) as Record<string, unknown> | null;
        if (!json) continue;

        const docEntities = entitiesByDoc.get(document.id) || [];

        lines.push(`  <TEI xml:id="doc_${document.id}">`);
        lines.push(`    <teiHeader>`);
        lines.push(`      <fileDesc>`);
        lines.push(`        <titleStmt><title>${escXml(document.filename)}</title></titleStmt>`);
        lines.push(`        <publicationStmt><p/></publicationStmt>`);
        lines.push(`        <sourceDesc>`);
        lines.push(`          <p>Status: ${document.status}</p>`);
        if (transcription.modelUsed) {
          lines.push(`          <p>Model: ${escXml(transcription.modelUsed)}</p>`);
        }
        if (transcription.reviewedAt) {
          lines.push(`          <p>Reviewed: ${transcription.reviewedAt.toISOString().split("T")[0]}</p>`);
        }
        lines.push(`        </sourceDesc>`);
        lines.push(`      </fileDesc>`);
        lines.push(`    </teiHeader>`);
        lines.push(`    <text>`);
        lines.push(`      <body>`);

        // Output each field as a div with a label
        for (const [fieldName, fieldValue] of Object.entries(json)) {
          if (fieldValue === null || fieldValue === undefined) continue;
          const valStr = Array.isArray(fieldValue)
            ? fieldValue.join("; ")
            : typeof fieldValue === "object"
              ? JSON.stringify(fieldValue)
              : String(fieldValue);

          if (!valStr.trim()) continue;

          // Tag entities inline in text content
          const taggedContent = tagEntitiesInText(valStr, docEntities);

          lines.push(`        <div type="field" n="${escXml(fieldName)}">`);
          lines.push(`          <head>${escXml(fieldName)}</head>`);
          lines.push(`          <p>${taggedContent}</p>`);
          lines.push(`        </div>`);
        }

        lines.push(`      </body>`);
        lines.push(`    </text>`);
        lines.push(`  </TEI>`);
      }

      lines.push(`</teiCorpus>`);

      return {
        xml: lines.join("\n"),
        filename: `${project.name.replace(/[^a-zA-Z0-9]/g, "_")}_corpus.xml`,
        count: docs.length,
      };
    }),
});

// ─── Jobs Router ──────────────────────────────────────────────────────────────

const jobsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return getJobsByProjectId(input.projectId);
    }),
});

// ─── Entities / Knowledge Graph Router ──────────────────────────────────────

import {
  getEntitiesByProject,
  getEntitiesByDocument,
  getEntityStats,
  getGraphData,
  getEntityDetails,
} from "./db";

const entitiesRouter = router({
  /** List all entities for a project, optionally filtered by type and search term */
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      type: z.enum(["person", "location", "organization"]).optional(),
      search: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      if (input.search && input.search.trim().length > 0) {
        return searchEntitiesByNameOrAlias(input.projectId, input.search.trim(), input.type);
      }
      return getEntitiesByProject(input.projectId, input.type);
    }),

  /** Get entities linked to a specific document */
  byDocument: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      documentId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const document = await getDocumentById(input.documentId, input.projectId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      return getEntitiesByDocument(input.projectId, input.documentId);
    }),

  /** Get entity count stats for a project */
  stats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return getEntityStats(input.projectId);
    }),

  /** Get knowledge graph data (nodes + edges) for visualization */
  graph: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return getGraphData(input.projectId);
    }),

  /** Get full entity profile: core data, document mentions, co-occurring connections */
  getDetails: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      entityId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const details = await getEntityDetails(input.projectId, input.entityId);
      if (!details) throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
      const aliases = await getEntityAliases(input.projectId, input.entityId);
      return { ...details, aliases };
    }),

  /** Update an entity's canonical name */
  updateName: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      entityId: z.number(),
      newName: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      await updateEntityName(input.entityId, input.projectId, input.newName);
      return { success: true };
    }),

  /** Bulk delete entities */
  delete: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      entityIds: z.array(z.number()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      await deleteEntities(input.entityIds, input.projectId);
      return { success: true, deleted: input.entityIds.length };
    }),

  /** Export entities as TEI-XML authority file */
  exportTeiXml: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const { getEntitiesByProject, getEntityAliasesBatch, getDb } = await import("./db");
      const { documentEntities, documents } = await import("../drizzle/schema");
      const { eq, inArray } = await import("drizzle-orm");

      const allEntities = await getEntitiesByProject(input.projectId);
      const entityIds = allEntities.map(e => e.id);
      const allAliases = await getEntityAliasesBatch(entityIds);

      // Get mention counts per entity
      const db = (await getDb())!;
      const mentionRows = entityIds.length > 0 ? await db
        .select({
          entityId: documentEntities.entityId,
          documentId: documentEntities.documentId,
          contextSnippet: documentEntities.contextSnippet,
          filename: documents.filename,
        })
        .from(documentEntities)
        .innerJoin(documents, eq(documents.id, documentEntities.documentId))
        .where(inArray(documentEntities.entityId, entityIds)) : [];

      // Group aliases and mentions by entity
      const aliasesByEntity = new Map<number, typeof allAliases>();
      for (const a of allAliases) {
        if (!aliasesByEntity.has(a.entityId)) aliasesByEntity.set(a.entityId, []);
        aliasesByEntity.get(a.entityId)!.push(a);
      }
      const mentionsByEntity = new Map<number, typeof mentionRows>();
      for (const m of mentionRows) {
        if (!mentionsByEntity.has(m.entityId)) mentionsByEntity.set(m.entityId, []);
        mentionsByEntity.get(m.entityId)!.push(m);
      }

      // Build TEI-XML
      const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const lines: string[] = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<entityRegistry project="${escXml(project.name)}" exported="${new Date().toISOString().split("T")[0]}" xmlns="http://www.tei-c.org/ns/1.0">`,
      ];

      for (const entity of allEntities) {
        const aliases = aliasesByEntity.get(entity.id) || [];
        const mentions = mentionsByEntity.get(entity.id) || [];
        lines.push(`  <entity xml:id="ent_${entity.id}" type="${entity.type}">`);
        lines.push(`    <canonical>${escXml(entity.name)}</canonical>`);
        if (aliases.length > 0) {
          lines.push(`    <variants>`);
          for (const a of aliases) {
            const langAttr = a.language ? ` xml:lang="${a.language}"` : "";
            lines.push(`      <variant${langAttr}>${escXml(a.alias)}</variant>`);
          }
          lines.push(`    </variants>`);
        }
        lines.push(`    <mentions count="${mentions.length}">`);
        // Include up to 10 representative mentions
        for (const m of mentions.slice(0, 10)) {
          const ctx = m.contextSnippet ? ` context="${escXml(m.contextSnippet)}"` : "";
          lines.push(`      <ref target="doc_${m.documentId}" source="${escXml(m.filename)}"${ctx}/>`);
        }
        lines.push(`    </mentions>`);
        lines.push(`  </entity>`);
      }

      lines.push(`</entityRegistry>`);
      return { xml: lines.join("\n"), filename: `${project.name.replace(/[^a-zA-Z0-9]/g, "_")}_entities.xml` };
    }),

  /** Re-extract entities for all reviewed documents (backfill) */
  reindexAll: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const reviewed = await getReviewedTranscriptions(input.projectId);
      let processed = 0;

      for (const row of reviewed) {
        const json = row.transcription.reviewedJson as Record<string, unknown> | null;
        if (!json) continue;
        const text = Object.values(json)
          .filter((v): v is string => typeof v === "string")
          .join("\n");
        if (text.length < 10) continue;

        try {
          await extractAndStoreEntities(input.projectId, row.transcription.documentId, text);
          processed++;
        } catch (err) {
          console.warn(`[NER] Reindex failed for doc ${row.transcription.documentId}:`, err);
        }
      }

      return { processed, total: reviewed.length };
    }),
});

// ─── Members Router ──────────────────────────────────────────────────────────

const membersRouter = router({
  /** List all members + pending invites for a project (owner only) */
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      const members = await getProjectMembers(input.projectId);
      const invites = role === "owner" ? await getProjectInvites(input.projectId) : [];
      // Get owner info from the project
      const project = await getProjectById(input.projectId, ctx.user.id);
      return { members, invites, currentUserRole: role, ownerId: project?.userId };
    }),

  /** Invite a collaborator by email (owner only) */
  invite: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      email: z.string().email(),
      role: z.enum(["editor", "viewer"]).default("editor"),
    }))
    .mutation(async ({ ctx, input }) => {
      const userRole = await getProjectRole(input.projectId, ctx.user.id);
      if (userRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner can invite collaborators" });

      // Check if email is already a member
      const existingUser = await getUserByEmail(input.email);
      if (existingUser) {
        const existingRole = await getProjectRole(input.projectId, existingUser.id);
        if (existingRole) throw new TRPCError({ code: "CONFLICT", message: "This user already has access to this project" });
      }

      // Check if there's already a pending invite for this email
      const existingInvites = await getProjectInvites(input.projectId);
      const alreadyInvited = existingInvites.find(i => i.email.toLowerCase() === input.email.toLowerCase());
      if (alreadyInvited) throw new TRPCError({ code: "CONFLICT", message: "An invite is already pending for this email" });

      // Generate a secure token
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invite = await createProjectInvite({
        projectId: input.projectId,
        invitedByUserId: ctx.user.id,
        email: input.email.toLowerCase(),
        role: input.role,
        token,
        status: "pending",
        expiresAt,
      });

      // If the user already exists in our system, auto-accept the invite
      if (existingUser) {
        if (!existingUser.email) throw new TRPCError({ code: "BAD_REQUEST", message: "The invited account has no verified email" });
        await acceptInvite(invite.id, existingUser.id, existingUser.email);
        return { invite: { ...invite, status: "accepted" as const }, autoAccepted: true };
      }

      return { invite, autoAccepted: false };
    }),

  /** Accept an invite by token (any authenticated user) */
  acceptByToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await getInviteByToken(input.token);
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or expired" });
      if (invite.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "This invite has already been used" });
      if (new Date() > invite.expiresAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This invite has expired" });
      if (!ctx.user.email) throw new TRPCError({ code: "FORBIDDEN", message: "A verified email address is required" });

      await acceptInvite(invite.id, ctx.user.id, ctx.user.email);
      return { projectId: invite.projectId, role: invite.role };
    }),

  /** Remove a member from a project (owner only, cannot remove self) */
  remove: protectedProcedure
    .input(z.object({ projectId: z.number(), userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userRole = await getProjectRole(input.projectId, ctx.user.id);
      if (userRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner can remove members" });
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
      await removeProjectMember(input.projectId, input.userId);
      return { success: true };
    }),

  /** Update a member's role (owner only) */
  updateRole: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userId: z.number(),
      role: z.enum(["editor", "viewer"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const userRole = await getProjectRole(input.projectId, ctx.user.id);
      if (userRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner can change roles" });
      await updateMemberRole(input.projectId, input.userId, input.role);
      return { success: true };
    }),

  /** Cancel a pending invite (owner only) */
  cancelInvite: protectedProcedure
    .input(z.object({ projectId: z.number(), inviteId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userRole = await getProjectRole(input.projectId, ctx.user.id);
      if (userRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only the project owner can cancel invites" });
      await cancelInvite(input.inviteId, input.projectId);
      return { success: true };
    }),

  /** Leave a project (any member except owner) */
  leave: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userRole = await getProjectRole(input.projectId, ctx.user.id);
      if (!userRole) throw new TRPCError({ code: "NOT_FOUND" });
      if (userRole === "owner") throw new TRPCError({ code: "BAD_REQUEST", message: "The owner cannot leave their own project. Transfer ownership or delete the project instead." });
      await removeProjectMember(input.projectId, ctx.user.id);
      return { success: true };
    }),

  /** Get current user's role for a project */
  myRole: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      return { role };
    }),
});

// ─── Entity Merge Router ─────────────────────────────────────────────────────

const mergeRouter = router({
  /** List merge suggestions for a project */
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      status: z.enum(["pending", "accepted", "rejected", "skipped"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });

      const db = (await import("./db")).getDb();
      const { mergeSuggestions, entities: entitiesTable, documentEntities: docEntTable, documents } = await import("../drizzle/schema");
      const { eq, and, sql } = await import("drizzle-orm");
      const dbConn = (await db)!;

      let query = dbConn
        .select()
        .from(mergeSuggestions)
        .where(
          input.status
            ? and(
                eq(mergeSuggestions.projectId, input.projectId),
                eq(mergeSuggestions.status, input.status),
              )
            : eq(mergeSuggestions.projectId, input.projectId),
        )
        .orderBy(mergeSuggestions.createdAt);

      const suggestions = await query;

      if (suggestions.length === 0) return [];

      // Collect all entity IDs across all suggestions in one pass
      const allEntityIds = Array.from(new Set(suggestions.flatMap((s) => s.entityIds as number[])));
      if (allEntityIds.length === 0) return suggestions.map(s => ({ ...s, entities: [], mentions: [] }));

      // Single batch query for all entity details
      const allEntities = await dbConn
        .select({
          id: entitiesTable.id,
          name: entitiesTable.name,
          type: entitiesTable.type,
        })
        .from(entitiesTable)
        .where(and(
          eq(entitiesTable.projectId, input.projectId),
          sql`${entitiesTable.id} IN (${sql.raw(allEntityIds.join(","))})`,
        ));

      // Single batch query for all document mentions
      const allMentions = await dbConn
        .select({
          entityId: docEntTable.entityId,
          documentId: docEntTable.documentId,
          contextSnippet: docEntTable.contextSnippet,
          documentFilename: documents.filename,
        })
        .from(docEntTable)
        .innerJoin(documents, eq(documents.id, docEntTable.documentId))
        .where(and(
          eq(docEntTable.projectId, input.projectId),
          eq(documents.projectId, input.projectId),
          sql`${docEntTable.entityId} IN (${sql.raw(allEntityIds.join(","))})`,
        ));

      // Index by entity ID for fast lookup
      const entityMap = new Map(allEntities.map(e => [e.id, e]));
      const mentionsByEntity = new Map<number, typeof allMentions>();
      for (const m of allMentions) {
        if (!mentionsByEntity.has(m.entityId)) mentionsByEntity.set(m.entityId, []);
        mentionsByEntity.get(m.entityId)!.push(m);
      }

      // Assemble enriched results in memory (no more DB calls)
      const enriched = suggestions.map((s) => {
        const entityIds = s.entityIds as number[];
        const entities = entityIds.map(id => entityMap.get(id)).filter(Boolean);
        const mentions = entityIds.flatMap(id => mentionsByEntity.get(id) || []);
        return { ...s, entities, mentions };
      });

      return enriched;
    }),

  /** Process a single step of merge analysis — called sequentially by the frontend */
  processStep: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      step: z.enum(["person_fuzzy", "person_cross", "location_fuzzy", "location_cross", "organization_fuzzy", "organization_cross"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and editors can generate merge suggestions" });
      }
      const result = await processMergeStep(input.projectId, input.step);
      return result;
    }),

  /** Accept a merge suggestion — merge entities into one canonical */
  accept: protectedProcedure
    .input(z.object({
      suggestionId: z.number(),
      canonicalName: z.string().min(1),
      entityIds: z.array(z.number()).min(2),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and editors can merge entities" });
      }
      const suggestion = await getMergeSuggestionById(input.suggestionId, input.projectId);
      if (!suggestion || suggestion.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      const entities = await getEntitiesByIds(input.projectId, input.entityIds);
      if (entities.length !== new Set(input.entityIds).size || entities.some((entity) => entity.projectId !== input.projectId)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await executeMerge(input.projectId, input.suggestionId, input.canonicalName, input.entityIds);
      return { success: true };
    }),

  /** Reject a merge suggestion — mark as definitely different */
  reject: protectedProcedure
    .input(z.object({ suggestionId: z.number(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const suggestion = await getMergeSuggestionById(input.suggestionId, input.projectId);
      if (!suggestion || suggestion.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await rejectMerge(input.projectId, input.suggestionId);
      return { success: true };
    }),

  /** Skip a merge suggestion — come back later */
  skip: protectedProcedure
    .input(z.object({ suggestionId: z.number(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const suggestion = await getMergeSuggestionById(input.suggestionId, input.projectId);
      if (!suggestion || suggestion.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await skipMerge(input.projectId, input.suggestionId);
      return { success: true };
    }),

  /** Manual merge — user selects entities to merge without AI suggestion */
  manual: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      canonicalName: z.string().min(1),
      entityIds: z.array(z.number()).min(2),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and editors can merge entities" });
      }
      const entities = await getEntitiesByIds(input.projectId, input.entityIds);
      if (entities.length !== new Set(input.entityIds).size || entities.some((entity) => entity.projectId !== input.projectId)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await manualMerge(input.projectId, input.canonicalName, input.entityIds);
      return { success: true };
    }),

  /** Get stats about merge progress */
  stats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });

      const db = (await import("./db")).getDb();
      const { mergeSuggestions } = await import("../drizzle/schema");
      const { eq, and, sql } = await import("drizzle-orm");
      const dbConn = (await db)!;

      const [stats] = await dbConn
        .select({
          total: sql<number>`count(*)`,
          pending: sql<number>`count(*) filter (where ${mergeSuggestions.status} = 'pending')`,
          accepted: sql<number>`count(*) filter (where ${mergeSuggestions.status} = 'accepted')`,
          rejected: sql<number>`count(*) filter (where ${mergeSuggestions.status} = 'rejected')`,
          skipped: sql<number>`count(*) filter (where ${mergeSuggestions.status} = 'skipped')`,
        })
        .from(mergeSuggestions)
        .where(eq(mergeSuggestions.projectId, input.projectId));

      return stats;
    }),
});

// ─── Document Groups Router (Multi-Page) ─────────────────────────────────────

const groupsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return getDocumentGroupsByProject(input.projectId);
    }),

  getById: protectedProcedure
    .input(z.object({ groupId: z.number(), projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const group = await getDocumentGroupById(input.groupId, input.projectId);
      if (!group || group.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      const pages = await getDocumentGroupPages(input.groupId, input.projectId);
      return { ...group, pages: pages.map(withDocumentAccessUrl) };
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      title: z.string().min(1),
      documentIds: z.array(z.number()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      await requireProjectDocuments(input.projectId, input.documentIds);
      const group = await createDocumentGroup({
        projectId: input.projectId,
        title: input.title,
        pageCount: input.documentIds.length,
      });
      // Add documents to group with page numbers
      for (let i = 0; i < input.documentIds.length; i++) {
        await addDocumentToGroup(input.documentIds[i], group.id, input.projectId, i + 1);
      }
      return group;
    }),

  addPage: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      projectId: z.number(),
      documentId: z.number(),
      pageNumber: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      const group = await getDocumentGroupById(input.groupId, input.projectId);
      if (!group || group.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      const document = await getDocumentById(input.documentId, input.projectId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      const pageNum = input.pageNumber ?? group.pageCount + 1;
      await addDocumentToGroup(input.documentId, input.groupId, input.projectId, pageNum);
      return { success: true };
    }),

  removePage: protectedProcedure
    .input(z.object({ documentId: z.number(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      const document = await getDocumentById(input.documentId, input.projectId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND" });
      await removeDocumentFromGroup(input.documentId, input.projectId);
      return { success: true };
    }),

  removePages: protectedProcedure
    .input(z.object({ documentIds: z.array(z.number()), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      await requireProjectDocuments(input.projectId, input.documentIds);
      for (const docId of input.documentIds) {
        await removeDocumentFromGroup(docId, input.projectId);
      }
      return { success: true, count: input.documentIds.length };
    }),

  reorderPages: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      projectId: z.number(),
      orderedDocIds: z.array(z.number()),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      const group = await getDocumentGroupById(input.groupId, input.projectId);
      if (!group || group.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await reorderGroupPages(input.groupId, input.projectId, input.orderedDocIds);
      return { success: true };
    }),

  updateTitle: protectedProcedure
    .input(z.object({ groupId: z.number(), projectId: z.number(), title: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      const group = await getDocumentGroupById(input.groupId, input.projectId);
      if (!group || group.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await updateDocumentGroupTitle(input.groupId, input.projectId, input.title);
      return { success: true };
    }),

  updateSharedMetadata: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      projectId: z.number(),
      sharedMetadata: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      const group = await getDocumentGroupById(input.groupId, input.projectId);
      if (!group || group.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await updateDocumentGroupMetadata(input.groupId, input.projectId, input.sharedMetadata as Record<string, unknown>);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ groupId: z.number(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      const group = await getDocumentGroupById(input.groupId, input.projectId);
      if (!group || group.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await deleteDocumentGroup(input.groupId, input.projectId);
      return { success: true };
    }),

  batchTranscribeAll: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });

      // Get all pages in order
      const group = await getDocumentGroupById(input.groupId, input.projectId);
      if (!group || group.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      const pages = await getDocumentGroupPages(input.groupId, input.projectId);
      if (pages.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "No pages in group" });

      // Find pages that need transcription (pending or error status)
      const pendingPages = pages.filter(p => p.status === "pending" || p.status === "error" || p.status === "processing");
      if (pendingPages.length === 0) {
        return { processed: 0, total: pages.length, message: "All pages already transcribed." };
      }

      // Define per-page fields (regenerated for each page) vs shared fields (set once from page 1)
      const PER_PAGE_FIELD_NAMES = new Set([
        "transcription", "full_arabic_transcription", "original_transcription",
        "english_translation", "full_english_translation", "translation",
        "summary", "notes", "description", "marginalia",
        "page_number", "section_of_act",
        "persons_mentioned", "keywords", "legal_references",
        "financial_amounts", "property_boundaries",
        "locations_mentioned", "institutions_mentioned",
        "mentioned_entities", "stamp_markings", "keywords_items",
        "registry_stamps", "registry_reference",
      ]);

      // Determine per-page field names from the project schema
      const schema = project.jsonSchema as Record<string, { type: string }> | null;
      const allFieldNames = schema ? Object.keys(schema) : [];
      const perPageFields = allFieldNames.filter(f => {
        const lower = f.toLowerCase();
        return PER_PAGE_FIELD_NAMES.has(lower) ||
          lower.includes("transcription") ||
          lower.includes("translation") ||
          lower.includes("page");
      });
      const sharedFieldNames = allFieldNames.filter(f => !perPageFields.includes(f));

      // Try to get shared metadata from page 1's existing transcription
      let sharedMetadata: Record<string, unknown> | undefined;
      const page1Transcription = await getTranscriptionByDocumentId(pages[0].id, input.projectId);
      if (page1Transcription) {
        const page1Data = (page1Transcription.reviewedJson ?? page1Transcription.rawJson) as Record<string, unknown> | null;
        if (page1Data) {
          sharedMetadata = {};
          for (const key of sharedFieldNames) {
            if (page1Data[key] !== undefined && !key.startsWith("_")) {
              sharedMetadata[key] = page1Data[key];
            }
          }
          // Only use shared metadata if we actually got meaningful fields
          if (Object.keys(sharedMetadata).length === 0) sharedMetadata = undefined;
        }
      }

      // Process sequentially so we can build context from each previous page
      let processed = 0;
      const errors: string[] = [];

      for (const page of pages) {
        // Skip pages that already have transcriptions (unless they're in error/processing state)
        if (page.status === "needs_review" || page.status === "reviewed") continue;

        try {
          await updateDocumentStatus(page.id, input.projectId, "processing");

          // Build context from ALL previous pages
          const pageIdx = pages.indexOf(page);
          let pageContext = "";
          for (let i = 0; i < pageIdx; i++) {
            const prevTranscription = await getTranscriptionByDocumentId(pages[i].id, input.projectId);
            if (prevTranscription?.reviewedJson) {
              const reviewed = prevTranscription.reviewedJson as Record<string, unknown>;
              const text = reviewed.transcription || reviewed.full_arabic_transcription || reviewed.Original_Transcription || "";
              pageContext += `--- Page ${i + 1} ---\n${text}\n\n`;
            } else if (prevTranscription?.rawJson) {
              const raw = prevTranscription.rawJson as Record<string, unknown>;
              const text = raw.transcription || raw.full_arabic_transcription || raw.Original_Transcription || "";
              pageContext += `--- Page ${i + 1} ---\n${text}\n\n`;
            }
          }

          // Fetch image
          const { storageGet: storageGetGroupPage } = await import("./storage");
          const { url: pageUrl } = await storageGetGroupPage(page.storagePath);
          const response = await fetch(pageUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const base64 = buffer.toString("base64");
          const mimeType = page.mimeType || "image/jpeg";

          // Process with context + shared metadata (for pages after page 1)
          const isFirstPage = pageIdx === 0;
          const result = await processDocument(project, base64, mimeType, page.filename, {
            pageContext: pageContext || undefined,
            sharedMetadata: (!isFirstPage && sharedMetadata) ? sharedMetadata : undefined,
            perPageFields: (!isFirstPage && sharedMetadata) ? perPageFields : undefined,
          });

          if (result.error) {
            await updateDocumentStatus(page.id, input.projectId, "error", result.error);
            errors.push(`Page ${page.pageNumber}: ${result.error}`);
          } else {
            const existing = await getTranscriptionByDocumentId(page.id, input.projectId);
            if (existing) {
              await updateReviewedJson(existing.id, page.id, input.projectId, result.rawJson);
            } else {
              await createTranscription({
                documentId: page.id,
                projectId: input.projectId,
                rawJson: result.rawJson,
                originalText: result.originalText || null,
                modelUsed: result.modelUsed,
              });
            }
            await updateDocumentStatus(page.id, input.projectId, "needs_review");
            processed++;

            // If this was page 1 and we didn't have shared metadata yet, extract it now
            if (isFirstPage && !sharedMetadata) {
              sharedMetadata = {};
              for (const key of sharedFieldNames) {
                if (result.rawJson[key] !== undefined && !key.startsWith("_")) {
                  sharedMetadata[key] = result.rawJson[key];
                }
              }
              if (Object.keys(sharedMetadata).length === 0) sharedMetadata = undefined;
            }
          }
        } catch (err) {
          await updateDocumentStatus(page.id, input.projectId, "error", String(err));
          errors.push(`Page ${page.pageNumber}: ${String(err)}`);
        }
      }

      // Save shared metadata to the group record for future reference
      if (sharedMetadata && Object.keys(sharedMetadata).length > 0) {
        await updateDocumentGroupMetadata(input.groupId, input.projectId, sharedMetadata);
      }

      return {
        processed,
        total: pages.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Transcribed ${processed} of ${pendingPages.length} pending pages.`,
      };
    }),

  transcribeWithContext: protectedProcedure
    .input(z.object({
      groupId: z.number(),
      projectId: z.number(),
      documentId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });

      // Get all pages in order
      const group = await getDocumentGroupById(input.groupId, input.projectId);
      if (!group || group.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      const pages = await getDocumentGroupPages(input.groupId, input.projectId);
      const targetPageIdx = pages.findIndex(p => p.id === input.documentId);
      if (targetPageIdx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Document not in group" });

      // Build context from previous pages' transcriptions
      let pageContext = "";
      for (let i = 0; i < targetPageIdx; i++) {
        const prevTranscription = await getTranscriptionByDocumentId(pages[i].id, input.projectId);
        if (prevTranscription?.reviewedJson) {
          const reviewed = prevTranscription.reviewedJson as Record<string, unknown>;
          const transcriptionText = reviewed.transcription || reviewed.full_arabic_transcription || reviewed.Original_Transcription || "";
          pageContext += `--- Page ${i + 1} ---\n${transcriptionText}\n\n`;
        } else if (prevTranscription?.rawJson) {
          const raw = prevTranscription.rawJson as Record<string, unknown>;
          const transcriptionText = raw.transcription || raw.full_arabic_transcription || raw.Original_Transcription || "";
          pageContext += `--- Page ${i + 1} ---\n${transcriptionText}\n\n`;
        }
      }

      // Get the target document's image
      const targetDoc = pages[targetPageIdx];
      // Fetch image and convert to base64
      const { storageGet: storageGetTargetPage } = await import("./storage");
      const { url: targetPageUrl } = await storageGetTargetPage(targetDoc.storagePath);
      const response = await fetch(targetPageUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString("base64");
      const mimeType = targetDoc.mimeType || "image/jpeg";

      // For pages after page 1, extract shared metadata from page 1 and pass it
      let sharedMetadata: Record<string, unknown> | undefined;
      let perPageFields: string[] | undefined;
      if (targetPageIdx > 0) {
        const PER_PAGE_FIELD_NAMES = new Set([
          "transcription", "full_arabic_transcription", "original_transcription",
          "english_translation", "full_english_translation", "translation",
          "summary", "notes", "description", "marginalia",
          "page_number", "section_of_act",
          "persons_mentioned", "keywords", "legal_references",
          "financial_amounts", "property_boundaries",
          "locations_mentioned", "institutions_mentioned",
          "mentioned_entities", "stamp_markings", "keywords_items",
          "registry_stamps", "registry_reference",
        ]);
        const schema = project.jsonSchema as Record<string, { type: string }> | null;
        const allFieldNames = schema ? Object.keys(schema) : [];
        perPageFields = allFieldNames.filter(f => {
          const lower = f.toLowerCase();
          return PER_PAGE_FIELD_NAMES.has(lower) || lower.includes("transcription") || lower.includes("translation") || lower.includes("page");
        });
        const sharedFieldNames = allFieldNames.filter(f => !perPageFields!.includes(f));

        // Get page 1's transcription for shared metadata
        const page1Transcription = await getTranscriptionByDocumentId(pages[0].id, input.projectId);
        if (page1Transcription) {
          const page1Data = (page1Transcription.reviewedJson ?? page1Transcription.rawJson) as Record<string, unknown> | null;
          if (page1Data) {
            sharedMetadata = {};
            for (const key of sharedFieldNames) {
              if (page1Data[key] !== undefined && !key.startsWith("_")) {
                sharedMetadata[key] = page1Data[key];
              }
            }
            if (Object.keys(sharedMetadata).length === 0) sharedMetadata = undefined;
          }
        }
      }

      // Process with page context + shared metadata
      const result = await processDocument(project, base64, mimeType, targetDoc.filename, {
        pageContext: pageContext || undefined,
        sharedMetadata,
        perPageFields,
      });

      // Save transcription
      if (!result.error) {
        const existing = await getTranscriptionByDocumentId(targetDoc.id, input.projectId);
        if (existing) {
          await updateReviewedJson(existing.id, targetDoc.id, input.projectId, result.rawJson);
        } else {
          await createTranscription({
            documentId: targetDoc.id,
            projectId: input.projectId,
            rawJson: result.rawJson,
            originalText: result.originalText || null,
            modelUsed: result.modelUsed,
          });
        }
        await updateDocumentStatus(targetDoc.id, input.projectId, "needs_review");
      }

      return { success: !result.error, result: result.rawJson, error: result.error };
    }),
});

// ─── Gamification Router ──────────────────────────────────────────────────────

const gamificationRouter = router({
  // Get current user's stats for a project
  myStats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      return getUserStats(ctx.user.id, input.projectId);
    }),

  // Get project leaderboard
  leaderboard: protectedProcedure
    .input(z.object({ projectId: z.number(), limit: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      return getLeaderboard(input.projectId, input.limit ?? 10);
    }),

  // Submit a line review (approve or correct) — awards XP
  submitLineReview: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      documentId: z.number(),
      transcriptionId: z.number(),
      lineIndex: z.number(),
      originalLine: z.string(),
      reviewedLine: z.string(),
      isCorrection: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });

      const [document, transcription] = await Promise.all([
        getDocumentById(input.documentId, input.projectId),
        getTranscriptionByDocumentId(input.documentId, input.projectId),
      ]);
      if (!document || !transcription || transcription.id !== input.transcriptionId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Review source not found" });
      }

      // Check for daily login bonus
      const dailyBonus = await maybeAwardStreakBonus(ctx.user.id, input.projectId);

      // Award XP for the line review
      const activityType = input.isCorrection ? "line_corrected" : "line_approved";
      const result = await awardXp({
        userId: ctx.user.id,
        projectId: input.projectId,
        documentId: input.documentId,
        activityType,
        metadata: {
          lineIndex: input.lineIndex,
          originalLine: input.originalLine,
          reviewedLine: input.reviewedLine,
        },
      });

      return {
        ...result,
        dailyBonus,
      };
    }),

  // Submit page completion bonus
  completePage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      documentId: z.number(),
      transcriptionId: z.number(),
      reviewedLines: z.array(z.object({
        index: z.number(),
        original: z.string(),
        reviewed: z.string(),
      })),
      metadataCorrections: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });

      const document = await getDocumentById(input.documentId, input.projectId);
      const transcription = await getTranscriptionByDocumentId(input.documentId, input.projectId);
      if (!document || !transcription || transcription.id !== input.transcriptionId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Review source not found" });
      }

      // Award page completion bonus
      const result = await awardXp({
        userId: ctx.user.id,
        projectId: input.projectId,
        documentId: input.documentId,
        activityType: "page_completed",
        metadata: { totalLines: input.reviewedLines.length },
      });

      // Also persist the reviewed transcription (merge lines back into the transcription)
      if (transcription) {
        const rawJson = transcription.rawJson as Record<string, unknown>;
        // Find the main text field and update it with reviewed lines
        const textFields = ["transcription", "original_text", "text", "content"];
        let mainTextField: string | null = null;
        for (const f of textFields) {
          if (typeof rawJson[f] === "string") { mainTextField = f; break; }
        }
        if (mainTextField) {
          const reviewedText = input.reviewedLines.map(l => l.reviewed).join("\n");
          const reviewedJson = { ...rawJson, [mainTextField]: reviewedText };
          // Apply metadata corrections from Quick Review
          if (input.metadataCorrections) {
            for (const [key, value] of Object.entries(input.metadataCorrections)) {
              reviewedJson[key] = value;
            }
          }
          await updateReviewedJson(transcription.id, input.documentId, input.projectId, reviewedJson);
          await updateDocumentStatus(input.documentId, input.projectId, "reviewed");

          // Fire-and-forget: embedding + NER
          embedTranscription({
            projectId: input.projectId,
            documentId: input.documentId,
            transcriptionId: transcription.id,
            reviewedJson,
            filename: "",
          }).catch(() => {});

          const textForNER = Object.values(reviewedJson)
            .filter((v): v is string => typeof v === "string")
            .join("\n");
          if (textForNER.length > 10) {
            reconcileDocumentEntities(input.projectId, input.documentId, textForNER).catch(() => {});
          }
        }
      }

      return result;
    }),

  // Get XP constants (for UI display)
  xpValues: publicProcedure.query(() => XP_VALUES),
});

// ─── Review Session Router ───────────────────────────────────────────────────

const reviewSessionRouter = router({
  get: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user.id);
      return getReviewSession(ctx.user.id, input.projectId);
    }),

  save: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      mode: z.string(),
      currentDocumentId: z.number().nullable(),
      currentLineIndex: z.number(),
      reviewedLines: z.record(z.string(), z.unknown()),
      selectedLanguage: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      if (input.currentDocumentId !== null) {
        const document = await getDocumentById(input.currentDocumentId, input.projectId);
        if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Review document not found" });
      }
      await saveReviewSession(ctx.user.id, input.projectId, {
        mode: input.mode,
        currentDocumentId: input.currentDocumentId,
        currentLineIndex: input.currentLineIndex,
        reviewedLines: input.reviewedLines,
        selectedLanguage: input.selectedLanguage,
      });
      return { success: true };
    }),
});

// ─── Validation Portal Router (Public — no auth required) ───────────────────

const validationRouter = router({
  // Get session info by share token (public)
  getSession: publicProcedure
    .input(z.object({ shareToken: z.string() }))
    .query(async ({ input }) => {
      const session = await getValidationSessionByToken(input.shareToken);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Validation session not found" });
      return {
        id: session.id,
        title: session.title,
        status: session.status,
        totalDocs: session.totalDocs,
        reviewsPerDoc: session.reviewsPerDoc,
      };
    }),

  // Get next assignment for a reviewer (public)
  getNextAssignment: publicProcedure
    .input(z.object({ shareToken: z.string(), reviewerUsername: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const session = await getValidationSessionByToken(input.shareToken);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      if (session.status === "closed") throw new TRPCError({ code: "FORBIDDEN", message: "Session is closed" });

      const assignment = await getNextAssignment(session.id, input.reviewerUsername);
      if (!assignment) return { assignment: null, document: null, lines: [], existingReviews: [] };

      // Get document info and transcription lines
      const doc = await getDocumentById(assignment.documentId, session.projectId);
      const transcription = await getTranscriptionByDocumentId(assignment.documentId, session.projectId);

      // Extract Arabic-only lines from the transcription
      let lines: { index: number; text: string }[] = [];
      if (transcription) {
        const json = (transcription.reviewedJson || transcription.rawJson) as Record<string, unknown>;
        // Look for Arabic text fields in priority order, then fall back to longest Arabic-containing string
        let rawText = "";
        const arabicFieldPriority = ["full_transcription_ar", "transcription", "Original_Transcription", "original_transcription"];
        for (const field of arabicFieldPriority) {
          if (json[field] && typeof json[field] === "string" && (json[field] as string).length > 50) {
            rawText = json[field] as string;
            break;
          }
        }
        if (!rawText) {
          // Fall back to longest string field that contains Arabic characters
          const arabicTest = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
          for (const [, val] of Object.entries(json)) {
            if (typeof val === "string" && val.length > rawText.length && arabicTest.test(val)) rawText = val;
          }
        }
        if (!rawText) {
          // Absolute fallback: longest string field regardless
          for (const [, val] of Object.entries(json)) {
            if (typeof val === "string" && val.length > rawText.length) rawText = val;
          }
        }

        // Split into lines — optionally filter to Arabic-only based on session setting
        const allLines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const allIndexed = allLines.map((text, idx) => ({ index: idx, text }));

        if (session.arabicOnly) {
          const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
          const englishOnlyRegex = /^[a-zA-Z0-9\s\[\]\(\)\-_:;.,!?'"]+$/;
          lines = allIndexed.filter(l => arabicRegex.test(l.text) && !englishOnlyRegex.test(l.text));
        } else {
          lines = allIndexed;
        }
      }

      // Update totalLines on assignment if not set
      if (assignment.totalLines === 0 && lines.length > 0) {
        const db = (await import("./db")).getDb;
        // We'll just return lines.length and update on first verdict
      }

      // Get already-reviewed lines for this assignment
      const existingReviews = await getReviewsForAssignment(assignment.id);

      return {
        assignment: {
          id: assignment.id,
          sessionId: session.id,
          documentId: assignment.documentId,
          status: assignment.status,
          linesReviewed: assignment.linesReviewed,
          totalLines: lines.length,
        },
        document: doc ? {
          id: doc.id,
          filename: doc.filename,
          storageUrl: validationDocumentAccessUrl(input.shareToken, session.projectId, doc.id),
        } : null,
        lines,
        existingReviews: existingReviews.map(r => ({ lineIndex: r.lineIndex, verdict: r.verdict })),
      };
    }),

  // Submit a line verdict (public)
  submitVerdict: publicProcedure
    .input(z.object({
      assignmentId: z.number(),
      shareToken: z.string().min(32).max(128),
      reviewerUsername: z.string().min(1).max(100),
      lineIndex: z.number().int().min(0),
      lineText: z.string().max(20_000),
      verdict: z.enum(["correct", "incorrect", "skipped"]),
      incorrectWords: z.array(z.object({
        wordIndex: z.number(),
        word: z.string(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      await submitLineVerdict(input);
      return { success: true };
    }),

  // Complete an assignment (public)
  completeAssignment: publicProcedure
    .input(z.object({
      assignmentId: z.number(),
      shareToken: z.string().min(32).max(128),
      reviewerUsername: z.string().min(1).max(100),
      totalLines: z.number().int().min(0).max(100_000),
    }))
    .mutation(async ({ input }) => {
      await completeAssignment(input);
      return { success: true };
    }),

  // Get reviewer progress (public)
  getProgress: publicProcedure
    .input(z.object({ shareToken: z.string(), reviewerUsername: z.string().min(1) }))
    .query(async ({ input }) => {
      const session = await getValidationSessionByToken(input.shareToken);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      return getReviewerProgress(session.id, input.reviewerUsername);
    }),

  // Admin: create validation session
  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      title: z.string().min(1).max(255),
      documentIds: z.array(z.number()).min(1),
      reviewsPerDoc: z.number().min(1).max(20).optional(),
      arabicOnly: z.boolean().optional(), // default true
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      await requireProjectDocuments(input.projectId, input.documentIds);

      const shareToken = crypto.randomBytes(16).toString("hex");
      const session = await createValidationSession({
        projectId: input.projectId,
        title: input.title,
        shareToken,
        documentIds: input.documentIds,
        reviewsPerDoc: input.reviewsPerDoc,
        arabicOnly: input.arabicOnly ?? true,
      });
      return { session, shareLink: `/review/${shareToken}` };
    }),

  // Admin: list sessions for a project
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      return getValidationSessionsByProject(input.projectId);
    }),

  // Admin: get stats for a session
  stats: protectedProcedure
    .input(z.object({ sessionId: z.number(), projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const session = await getValidationSessionById(input.sessionId, input.projectId);
      if (!session || session.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      return getValidationStats(input.sessionId, input.projectId);
    }),

  // Admin: close a session
  close: protectedProcedure
    .input(z.object({ sessionId: z.number(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const session = await getValidationSessionById(input.sessionId, input.projectId);
      if (!session || session.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await closeValidationSession(input.sessionId, input.projectId);
      return { success: true };
    }),

  // Admin: delete a session
  delete: protectedProcedure
    .input(z.object({ sessionId: z.number(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user.id);
      const session = await getValidationSessionById(input.sessionId, input.projectId);
      if (!session || session.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await deleteValidationSession(input.sessionId, input.projectId);
      return { success: true };
    }),
});

// ─── Research Agent (Codex) Router ───────────────────────────────────────────

const researchRouter = router({
  /** Run a research query — the Codex agent processes the question with tools */
  ask: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      question: z.string().min(1).max(8000),
      conversationId: z.number().optional(),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await runResearchAgent({
        projectId: input.projectId,
        projectName: project.name,
        projectSchema: project.jsonSchema as Record<string, unknown> | null,
        question: input.question,
        history: input.history,
      });

      // Auto-save to conversation
      if (input.conversationId) {
        const conv = await getResearchConversation(input.conversationId, ctx.user.id);
        if (conv && conv.projectId === input.projectId) {
          const messages = (conv.messages as unknown[]) || [];
          messages.push({ role: "user", content: input.question });
          messages.push({
            role: "assistant",
            content: result.answer,
            thinking: result.thinking,
            visualizations: result.visualizations,
            citations: result.citations,
          });
          await updateResearchConversation(input.conversationId, { messages });
        } else if (conv) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found in project" });
        }
      }

      return result;
    }),

  /** Create a new research conversation */
  createConversation: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      title: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const conv = await createResearchConversation({
        projectId: input.projectId,
        userId: ctx.user.id,
        title: input.title || "New Research",
        messages: [],
      });
      return conv;
    }),

  /** List all research conversations for this project */
  getConversations: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return getResearchConversations(input.projectId, ctx.user.id);
    }),

  /** Get a single conversation with full messages */
  getConversation: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const conv = await getResearchConversation(input.id, ctx.user.id);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      await requireProjectAccess(conv.projectId, ctx.user.id);
      return conv;
    }),

  /** Update conversation title */
  updateTitle: protectedProcedure
    .input(z.object({ id: z.number(), title: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getResearchConversation(input.id, ctx.user.id);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      await requireProjectAccess(conv.projectId, ctx.user.id);
      await updateResearchConversation(input.id, { title: input.title });
      return { success: true };
    }),

  /** Delete a conversation */
  deleteConversation: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conv = await getResearchConversation(input.id, ctx.user.id);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      await requireProjectAccess(conv.projectId, ctx.user.id);
      await deleteResearchConversation(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ─── Activity Feed Router ────────────────────────────────────────────────────

const activityRouter = router({
  /** Get paginated activity feed for a project */
  feed: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
      userId: z.number().optional(),
      action: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });
      return getActivityFeed(input.projectId, {
        limit: input.limit,
        offset: input.offset,
        userId: input.userId,
        action: input.action,
      });
    }),
});

// ─── Document Assignments (Review Queue) Router ──────────────────────────────

const assignmentsRouter = router({
  /** Assign documents to a team member */
  assign: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      documentIds: z.array(z.number()).min(1),
      assigneeId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      await requireProjectDocuments(input.projectId, input.documentIds);
      const assigneeRole = await getProjectRole(input.projectId, input.assigneeId);
      if (!assigneeRole) throw new TRPCError({ code: "BAD_REQUEST", message: "Assignee is not a project member" });
      const result = await assignDocuments({
        projectId: input.projectId,
        documentIds: input.documentIds,
        assigneeId: input.assigneeId,
        assignedBy: ctx.user.id,
      });
      // Log activity
      await logActivity({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "document_assigned",
        metadata: { assigneeId: input.assigneeId, count: input.documentIds.length },
      });
      return result;
    }),

  /** Get my review queue */
  myQueue: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });
      return getMyQueue(input.projectId, ctx.user.id);
    }),

  /** Get all assignments for a project (admin view) */
  all: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      return getProjectAssignments(input.projectId);
    }),

  /** Get per-member stats */
  stats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });
      return getAssignmentStats(input.projectId);
    }),

  /** Update assignment status */
  updateStatus: protectedProcedure
    .input(z.object({
      assignmentId: z.number(),
      projectId: z.number(),
      status: z.enum(["pending", "in_progress", "completed"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN" });
      const assignment = await getDocumentAssignmentById(input.assignmentId, input.projectId);
      if (!assignment || assignment.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await updateAssignmentStatus(
        input.assignmentId,
        input.projectId,
        input.status,
        role === "viewer" ? ctx.user.id : undefined,
      );
      return { success: true };
    }),

  /** Delete an assignment */
  delete: protectedProcedure
    .input(z.object({ assignmentId: z.number(), projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(input.projectId, ctx.user.id);
      if (!role || role === "viewer") throw new TRPCError({ code: "FORBIDDEN" });
      const assignment = await getDocumentAssignmentById(input.assignmentId, input.projectId);
      if (!assignment || assignment.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND" });
      await deleteAssignment(input.assignmentId, input.projectId);
      return { success: true };
    }),
});

// ─── App Router ───────────────────────────────────────────────────────────────

// ─── Billing Router ──────────────────────────────────────────────────────────

const billingRouter = router({
  getPlans: publicProcedure.query(() => {
    const { PLANS, BILLING_LAUNCH_ENABLED } = require("./billing/products");
    return { plans: PLANS, paidUpgradesEnabled: BILLING_LAUNCH_ENABLED };
  }),
  getMyPlan: protectedProcedure.query(async ({ ctx }) => {
    const { PLANS, BILLING_LAUNCH_ENABLED } = require("./billing/products");
    const quota = await getDocumentQuotaStatus(ctx.user.id);
    const plan = "free" as const;
    return {
      plan,
      planName: quota.plan === "owner" ? "Owner access" : PLANS.free.name,
      documentLimit: quota.documentLimit,
      documentsUsed: quota.documentsUsed,
      documentsRemaining: quota.documentsRemaining,
      isOwnerExempt: quota.plan === "owner",
      paidUpgradesEnabled: BILLING_LAUNCH_ENABLED,
      features: PLANS[plan]?.features || [],
    };
  }),

  createCheckout: protectedProcedure
    .input(z.object({ planId: z.enum(["pro", "team"]), origin: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { BILLING_LAUNCH_ENABLED } = require("./billing/products");
      if (!BILLING_LAUNCH_ENABLED) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Paid upgrades are not available yet." });
      }
      const { createCheckoutSession } = require("./billing/stripe");
      const url = await createCheckoutSession({
        userId: ctx.user.id,
        userEmail: ctx.user.email || "",
        userName: ctx.user.name || "",
        planId: input.planId,
        stripeCustomerId: (ctx.user as any).stripeCustomerId,
        origin: input.origin,
      });
      return { url };
    }),

  createPortal: protectedProcedure
    .input(z.object({ origin: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { BILLING_LAUNCH_ENABLED } = require("./billing/products");
      if (!BILLING_LAUNCH_ENABLED) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Paid upgrades are not available yet." });
      }
      const customerId = (ctx.user as any).stripeCustomerId;
      if (!customerId) throw new TRPCError({ code: "BAD_REQUEST", message: "No active subscription" });
      const { createPortalSession } = require("./billing/stripe");
      const url = await createPortalSession(customerId, input.origin);
      return { url };
    }),
});


const platformRouter = router({
  documentCount: publicProcedure.query(async () => {
    const { getPlatformDocumentCount } = await import("./db");
    const count = await getPlatformDocumentCount();
    return { count, goal: 1_000_000 };
  }),
});

export const appRouter = router({
  admin: adminRouter,
  system: systemRouter,
  auth: authRouter,
  projects: projectsRouter,
  platform: platformRouter,
  onboarding: onboardingRouter,
  documents: documentsRouter,
  transcriptions: transcriptionsRouter,
  export: exportRouter,
  jobs: jobsRouter,
  rag: ragRouter,
  entities: entitiesRouter,
  members: membersRouter,
  merge: mergeRouter,
  groups: groupsRouter,
  gamification: gamificationRouter,
  reviewSession: reviewSessionRouter,
  validation: validationRouter,
  research: researchRouter,
  activity: activityRouter,
  assignments: assignmentsRouter,
  billing: billingRouter,
  visualArchives: visualArchivesRouter,
});

export type AppRouter = typeof appRouter;
