import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  getProjectsByUserId,
  getProjectById,
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
  getReviewedDocsWithoutEmbeddings,
  createJob,
  getJobsByProjectId,
  updateJob,
  deleteProject,
} from "./db";
import { generateProjectConfig, validateConfig, refineConfig } from "./onboardingAgent";
import { processDocument } from "./transcriptionEngine";
import { storagePut } from "./storage";
import { TRPCError } from "@trpc/server";
import { embedTranscription, semanticSearch } from "./embeddingService";
import { extractAndStoreEntities } from "./nerService";
import { invokeLLM } from "./_core/llm";

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
    return getProjectsByUserId(ctx.user.id);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return project;
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
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Get all reviewed/flagged documents that don't have embeddings
      const docs = await getReviewedDocsWithoutEmbeddings(input.id);

      // Generate embeddings in batches
      const batchSize = 5;
      let indexed = 0;

      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (doc) => {
            try {
              await embedTranscription({
                projectId: input.id,
                documentId: doc.documentId,
                transcriptionId: doc.transcriptionId,
                reviewedJson: doc.reviewedJson as Record<string, unknown>,
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

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.id, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
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
      return getSamplesByProjectId(input.projectId);
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
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Store image to S3
      const imageBuffer = Buffer.from(input.imageBase64, "base64");
      const key = `projects/${input.projectId}/samples/${Date.now()}-${input.filename}`;
      const { url } = await storagePut(key, imageBuffer, input.mimeType ?? "image/jpeg");

      await createOnboardingSample({
        projectId: input.projectId,
        imagePath: key,
        imageUrl: url,
        filename: input.filename,
        manualTranscription: input.manualTranscription,
        isHeldOut: input.isHeldOut,
      });

      return { success: true, imageUrl: url };
    }),

  generateConfig: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
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
          const resp = await fetch(url);
          const buf = await resp.arrayBuffer();
          const base64 = Buffer.from(buf).toString("base64");
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
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      if (!project.systemPrompt) throw new TRPCError({ code: "BAD_REQUEST", message: "Generate config first." });

      const samples = await getSamplesByProjectId(input.projectId);
      const heldOut = samples.find(s => s.isHeldOut) ?? samples[samples.length - 1];
      if (!heldOut) throw new TRPCError({ code: "BAD_REQUEST", message: "No samples found." });

      // Fetch held-out image
      const { storageGet: storageGetValidate } = await import("./storage");
      const { url } = await storageGetValidate(heldOut.imagePath);
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      const base64 = Buffer.from(buf).toString("base64");

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
      await updateSampleAiOutput(heldOut.id, result.aiOutput, result.score);

      return result;
    }),

  refine: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      feedback: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const samples = await getSamplesByProjectId(input.projectId);
      const samplePairs = await Promise.all(
        samples.filter(s => !s.isHeldOut).map(async (s) => {
          const { storageGet: storageGetRefine } = await import("./storage");
          const { url } = await storageGetRefine(s.imagePath);
          const resp = await fetch(url);
          const buf = await resp.arrayBuffer();
          const base64 = Buffer.from(buf).toString("base64");
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
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await updateProject(input.projectId, ctx.user.id, { status: "active" });
      return { success: true };
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
      return getDocumentsByProjectId(input.projectId, input.status);
    }),

  // Returns a fresh presigned URL for viewing a document image (stored URLs expire)
  getImageUrl: protectedProcedure
    .input(z.object({ documentId: z.number(), projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const doc = await getDocumentById(input.documentId, input.projectId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      const { storageGet } = await import("./storage");
      const { url } = await storageGet(doc.storagePath);
      return { url, filename: doc.filename, mimeType: doc.mimeType };
    }),

  upload: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      filename: z.string(),
      fileBase64: z.string(),
      mimeType: z.string().default("image/jpeg"),
      fileSizeBytes: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      if (project.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Project must be active to upload documents." });
      }

      const buffer = Buffer.from(input.fileBase64, "base64");
      const key = `projects/${input.projectId}/documents/${Date.now()}-${input.filename}`;
      const { url } = await storagePut(key, buffer, input.mimeType ?? "image/jpeg");

      await createDocument({
        projectId: input.projectId,
        filename: input.filename,
        storagePath: key,
        storageUrl: url,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes ?? null,
        status: "pending",
      });

      const docs = await getDocumentsByProjectId(input.projectId);
      return docs[0];
    }),

  transcribe: protectedProcedure
    .input(z.object({
      documentId: z.number(),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const doc = await getDocumentById(input.documentId, input.projectId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      // Mark as processing
      await updateDocumentStatus(input.documentId, "processing");

      try {
        // Fetch image from storage
        const { storageGet: storageGetDoc } = await import("./storage");
        const { url } = await storageGetDoc(doc.storagePath);
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        const base64 = Buffer.from(buf).toString("base64");

        const result = await processDocument(project, base64, doc.mimeType ?? "image/jpeg", doc.filename);

        if (result.error) {
          await updateDocumentStatus(input.documentId, "error", result.error);
          return { success: false, error: result.error };
        }

        await createTranscription({
          documentId: input.documentId,
          projectId: input.projectId,
          modelUsed: result.modelUsed,
          rawJson: result.rawJson,
          originalText: result.originalText ?? null,
        });

        await updateDocumentStatus(input.documentId, "needs_review");
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await updateDocumentStatus(input.documentId, "error", msg);
        return { success: false, error: msg };
      }
    }),

  batchTranscribe: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
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
      const CONCURRENCY = 3;
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
              await updateDocumentStatus(doc.id, "processing");
              const { storageGet: storageGetBatch } = await import("./storage");
              const { url } = await storageGetBatch(doc.storagePath);
              const resp = await fetch(url);
              const buf = await resp.arrayBuffer();
              const base64 = Buffer.from(buf).toString("base64");
              const result = await processDocument(project, base64, doc.mimeType ?? "image/jpeg", doc.filename);

              if (result.error) {
                await updateDocumentStatus(doc.id, "error", result.error);
              } else {
                await createTranscription({
                  documentId: doc.id,
                  projectId: input.projectId,
                  modelUsed: result.modelUsed,
                  rawJson: result.rawJson,
                  originalText: result.originalText ?? null,
                });
                await updateDocumentStatus(doc.id, "needs_review");
              }
            } catch (err) {
              await updateDocumentStatus(doc.id, "error", String(err));
            }
            completed++;
          }));
          await updateJob(job.id, {
            completedItems: completed,
            progress: Math.round((completed / pendingDocs.length) * 100),
          });
        }

        await updateJob(job.id, { status: "completed", progress: 100, completedItems: pendingDocs.length });
      })().catch(console.error);

      return { queued: pendingDocs.length, message: `Queued ${pendingDocs.length} documents for transcription.` };
    }),
});

// ─── Transcriptions Router ────────────────────────────────────────────────────

const transcriptionsRouter = router({
  getByDocument: protectedProcedure
    .input(z.object({ documentId: z.number(), projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return getTranscriptionByDocumentId(input.documentId);
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
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      await updateReviewedJson(input.transcriptionId, input.reviewedJson);
      await updateDocumentStatus(input.documentId, input.status);

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

      // Fire-and-forget: extract named entities (NER) via Gemini
      const textForNER = Object.values(input.reviewedJson)
        .filter((v): v is string => typeof v === "string")
        .join("\n");
      if (textForNER.length > 10) {
        extractAndStoreEntities(input.projectId, input.documentId, textForNER)
          .catch((err) => console.warn("[NER] Failed:", err));
      }

      return { success: true };
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
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const reviewed = await getReviewedTranscriptions(input.projectId);
      if (reviewed.length === 0) return { csv: "", count: 0 };

      const schema = project.jsonSchema as Record<string, { type: string }> | null;
      const schemaFields = schema ? Object.keys(schema) : [];
      const headers = ["filename", "status", "reviewed_at", "model_used", ...schemaFields];

      const rows = reviewed.map(({ transcription, document }) => {
        const data = (transcription.reviewedJson ?? transcription.rawJson) as Record<string, unknown>;
        const row: Record<string, string> = {
          filename: document.filename,
          status: document.status,
          reviewed_at: transcription.reviewedAt?.toISOString() ?? "",
          model_used: transcription.modelUsed,
        };
        for (const field of schemaFields) {
          const val = data[field];
          row[field] = Array.isArray(val) ? val.join(" | ") : String(val ?? "");
        }
        return row;
      });

      const csvLines = [
        headers.join(","),
        ...rows.map(r => headers.map(h => `"${(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
      ];

      return { csv: csvLines.join("\n"), count: reviewed.length };
    }),

  jsonZip: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const reviewed = await getReviewedTranscriptions(input.projectId);
      return reviewed.map(({ transcription, document }) => ({
        filename: document.filename.replace(/\.[^.]+$/, "") + ".json",
        data: transcription.reviewedJson ?? transcription.rawJson,
      }));
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
  /** List all entities for a project, optionally filtered by type */
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      type: z.enum(["person", "location", "organization"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
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
      return getEntitiesByDocument(input.documentId);
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
      return details;
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

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  projects: projectsRouter,
  onboarding: onboardingRouter,
  documents: documentsRouter,
  transcriptions: transcriptionsRouter,
  export: exportRouter,
  jobs: jobsRouter,
  rag: ragRouter,
  entities: entitiesRouter,
});

export type AppRouter = typeof appRouter;
