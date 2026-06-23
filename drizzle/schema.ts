import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  jsonb,
  real,
  boolean,
  index,
  serial,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Custom vector type for pgvector ─────────────────────────────────────────
// We use a raw SQL column since drizzle-orm doesn't have a built-in vector type.
// Dimension 3072 matches Google gemini-embedding-2-preview.
import { customType } from "drizzle-orm/pg-core";

export const vector = customType<{ data: number[]; driverData: string; config: { dimensions?: number } }>({
  dataType(config) {
    return `vector(${(config as { dimensions?: number } | undefined)?.dimensions ?? 768})`;
  },
  fromDriver(value: string): number[] {
    // pgvector returns "[0.1,0.2,...]" — parse it
    return JSON.parse(value.replace(/^\[/, "[").replace(/\]$/, "]"));
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

// ─── Enums ────────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "editor", "viewer"]);
export const inviteStatusEnum = pgEnum("invite_status", ["pending", "accepted", "expired"]);
export const projectStatusEnum = pgEnum("project_status", ["onboarding", "validating", "active", "archived"]);
export const pipelineTypeEnum = pgEnum("pipeline_type", ["single_pass", "two_pass"]);
export const documentStatusEnum = pgEnum("document_status", [
  "pending", "processing", "needs_review", "reviewed", "flagged", "error",
]);
export const jobTypeEnum = pgEnum("job_type", ["transcribe", "batch_transcribe", "validate_config", "entity_merge"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "completed", "failed"]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: projectStatusEnum("status").default("onboarding").notNull(),

  // AI Engine Configuration
  modelProvider: varchar("modelProvider", { length: 64 }).default("gemini").notNull(),
  modelName: varchar("modelName", { length: 128 }).default("gemini-2.5-flash").notNull(),
  pipelineType: pipelineTypeEnum("pipelineType").default("single_pass").notNull(),
  temperature: real("temperature").default(0.1).notNull(),
  maxTokens: integer("maxTokens").default(4096).notNull(),

  // Generated configuration (from AI onboarding agent)
  systemPrompt: text("systemPrompt"),
  pass2Prompt: text("pass2Prompt"),
  jsonSchema: jsonb("jsonSchema"),
  glossary: jsonb("glossary"),
  postProcessing: jsonb("postProcessing"),
  outputFormats: jsonb("outputFormats"),

  // Onboarding reasoning from AI agent
  onboardingReasoning: text("onboardingReasoning"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("projects_userId_idx").on(t.userId),
]);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// ─── Onboarding Samples ───────────────────────────────────────────────────────

export const onboardingSamples = pgTable("onboarding_samples", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  imagePath: text("imagePath").notNull(),
  imageUrl: text("imageUrl"),
  filename: varchar("filename", { length: 255 }),
  manualTranscription: jsonb("manualTranscription").notNull(),
  aiOutput: jsonb("aiOutput"),
  validationScore: real("validationScore"),
  isHeldOut: boolean("isHeldOut").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("samples_projectId_idx").on(t.projectId),
]);

export type OnboardingSample = typeof onboardingSamples.$inferSelect;
export type InsertOnboardingSample = typeof onboardingSamples.$inferInsert;

// ─── Documents ────────────────────────────────────────────────────────────────

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 255 }).notNull(),
  storagePath: text("storagePath").notNull(),
  storageUrl: text("storageUrl"),
  mimeType: varchar("mimeType", { length: 64 }).default("image/jpeg"),
  fileSizeBytes: integer("fileSizeBytes"),
  status: documentStatusEnum("status").default("pending").notNull(),
  errorMessage: text("errorMessage"),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
}, (t) => [
  index("documents_projectId_idx").on(t.projectId),
  index("documents_status_idx").on(t.status),
]);

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

// ─── Transcriptions ───────────────────────────────────────────────────────────

export const transcriptions = pgTable("transcriptions", {
  id: serial("id").primaryKey(),
  documentId: integer("documentId").notNull().references(() => documents.id, { onDelete: "cascade" }),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  modelUsed: varchar("modelUsed", { length: 128 }).notNull(),
  rawJson: jsonb("rawJson").notNull(),
  reviewedJson: jsonb("reviewedJson"),
  originalText: text("originalText"),
  confidenceNotes: text("confidenceNotes"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("transcriptions_documentId_idx").on(t.documentId),
  index("transcriptions_projectId_idx").on(t.projectId),
]);

export type Transcription = typeof transcriptions.$inferSelect;
export type InsertTranscription = typeof transcriptions.$inferInsert;

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: integer("documentId").references(() => documents.id, { onDelete: "cascade" }),
  type: jobTypeEnum("type").notNull(),
  status: jobStatusEnum("status").default("queued").notNull(),
  progress: integer("progress").default(0),
  totalItems: integer("totalItems").default(1),
  completedItems: integer("completedItems").default(0),
  errorMessage: text("errorMessage"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("jobs_projectId_idx").on(t.projectId),
  index("jobs_status_idx").on(t.status),
]);

export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;

// ─── Document Embeddings (pgvector) ──────────────────────────────────────────
// Stores vector embeddings for semantic search. Strictly isolated by project_id.
// Uses Google gemini-embedding-2-preview (3072 dimensions).

export const documentEmbeddings = pgTable("document_embeddings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: integer("documentId").notNull().references(() => documents.id, { onDelete: "cascade" }),
  transcriptionId: integer("transcriptionId").references(() => transcriptions.id, { onDelete: "cascade" }),
  content: text("content").notNull(),           // The embedded text string
  metadata: jsonb("metadata"),                  // { sender, date, site, source, filename }
  embedding: vector("embedding", { dimensions: 3072 }),
  // tsvector for full-text search (populated by trigger or on insert)
  contentTsv: text("content_tsv"),              // stored as text, queried via raw SQL
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("embeddings_projectId_idx").on(t.projectId),
  index("embeddings_documentId_idx").on(t.documentId),
]);

export type DocumentEmbedding = typeof documentEmbeddings.$inferSelect;
export type InsertDocumentEmbedding = typeof documentEmbeddings.$inferInsert;

// ─── Entity Type Enum ────────────────────────────────────────────────────────

export const entityTypeEnum = pgEnum("entity_type", ["person", "location", "organization"]);

// ─── Entities ────────────────────────────────────────────────────────────────
// Named entities extracted via NER (Gemini). Deduplicated per project by name+type.

export const entities = pgTable("entities", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 512 }).notNull(),
  type: entityTypeEnum("type").notNull(),
  normalizedName: varchar("normalizedName", { length: 512 }),  // lowercased / stripped for dedup
  canonicalId: integer("canonicalId"),  // self-ref FK: points to the master/canonical entity (null = is canonical)
  metadata: jsonb("metadata"),  // optional extra info (e.g., alternate spellings, notes)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("entities_projectId_idx").on(t.projectId),
  index("entities_name_type_idx").on(t.projectId, t.normalizedName, t.type),
  index("entities_canonicalId_idx").on(t.canonicalId),
]);

export type Entity = typeof entities.$inferSelect;
export type InsertEntity = typeof entities.$inferInsert;

// ─── Document–Entity Join Table ──────────────────────────────────────────────
// Links entities to the documents they appear in, with optional context snippet.

export const documentEntities = pgTable("document_entities", {
  id: serial("id").primaryKey(),
  documentId: integer("documentId").notNull().references(() => documents.id, { onDelete: "cascade" }),
  entityId: integer("entityId").notNull().references(() => entities.id, { onDelete: "cascade" }),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contextSnippet: text("contextSnippet"),  // sentence or phrase where entity was found
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("docent_documentId_idx").on(t.documentId),
  index("docent_entityId_idx").on(t.entityId),
  index("docent_projectId_idx").on(t.projectId),
]);

export type DocumentEntity = typeof documentEntities.$inferSelect;
export type InsertDocumentEntity = typeof documentEntities.$inferInsert;

// ─── Project Members ────────────────────────────────────────────────────────
// Tracks who has access to a project and with what role.

export const projectMembers = pgTable("project_members", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRoleEnum("role").default("viewer").notNull(),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
}, (t) => [
  index("pm_projectId_idx").on(t.projectId),
  index("pm_userId_idx").on(t.userId),
  index("pm_project_user_idx").on(t.projectId, t.userId),
]);

export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = typeof projectMembers.$inferInsert;

// ─── Project Invites ────────────────────────────────────────────────────────
// Pending invitations sent by project owner to collaborators via email.

export const projectInvites = pgTable("project_invites", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  invitedByUserId: integer("invitedByUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  role: memberRoleEnum("role").default("editor").notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  status: inviteStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
}, (t) => [
  index("pi_projectId_idx").on(t.projectId),
  index("pi_email_idx").on(t.email),
  index("pi_token_idx").on(t.token),
]);

export type ProjectInvite = typeof projectInvites.$inferSelect;
export type InsertProjectInvite = typeof projectInvites.$inferInsert;

// ─── Entity Aliases ──────────────────────────────────────────────────────────
// Stores alternate surface forms for a canonical entity (for search matching).

export const entityAliases = pgTable("entity_aliases", {
  id: serial("id").primaryKey(),
  entityId: integer("entityId").notNull().references(() => entities.id, { onDelete: "cascade" }),
  alias: varchar("alias", { length: 512 }).notNull(),
  normalizedAlias: varchar("normalizedAlias", { length: 512 }),
  language: varchar("language", { length: 32 }),  // e.g., "ar", "fr", "en"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("ea_entityId_idx").on(t.entityId),
  index("ea_normalizedAlias_idx").on(t.normalizedAlias),
]);

export type EntityAlias = typeof entityAliases.$inferSelect;
export type InsertEntityAlias = typeof entityAliases.$inferInsert;

// ─── Merge Suggestions ───────────────────────────────────────────────────────
// LLM-generated proposals for merging duplicate entities. Reviewed by humans.

export const mergeSuggestionStatusEnum = pgEnum("merge_suggestion_status", ["pending", "accepted", "rejected", "skipped"]);

export const mergeSuggestions = pgTable("merge_suggestions", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: mergeSuggestionStatusEnum("status").default("pending").notNull(),
  suggestedCanonical: varchar("suggestedCanonical", { length: 512 }).notNull(),
  confidence: varchar("confidence", { length: 16 }).notNull(),  // "high", "medium", "low"
  entityIds: jsonb("entityIds").notNull(),  // number[] — IDs of entities in this cluster
  reasoning: text("reasoning"),  // LLM's explanation for why these are the same
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
}, (t) => [
  index("ms_projectId_idx").on(t.projectId),
  index("ms_status_idx").on(t.status),
]);

export type MergeSuggestion = typeof mergeSuggestions.$inferSelect;
export type InsertMergeSuggestion = typeof mergeSuggestions.$inferInsert;
