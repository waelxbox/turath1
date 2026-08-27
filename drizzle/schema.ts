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
  uniqueIndex,
  foreignKey,
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
export const planEnum = pgEnum("plan", ["free", "pro", "team", "enterprise"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "canceled", "past_due", "trialing"]);
export const archiveModeEnum = pgEnum("archive_mode", ["document_transcription", "visual_vra"]);
export const visualAssetStatusEnum = pgEnum("visual_asset_status", ["uploaded", "ready", "failed", "deletion_pending"]);
export const vraRecordTypeEnum = pgEnum("vra_record_type", ["collection", "work", "image"]);
export const vraRecordStatusEnum = pgEnum("vra_record_status", ["draft", "needs_review", "approved", "archived"]);
export const vraRelationStatusEnum = pgEnum("vra_relation_status", ["suggested", "approved", "rejected"]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  plan: planEnum("plan").default("free").notNull(),
  documentQuotaUsed: integer("documentQuotaUsed").default(0).notNull(),
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

// Visual projects opt in through an immutable one-to-one discriminator row.
// Existing projects have no row and remain document_transcription projects.
export const visualProjectModes = pgTable("visual_project_modes", {
  projectId: integer("projectId").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  archiveMode: archiveModeEnum("archiveMode").default("visual_vra").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VisualProjectMode = typeof visualProjectModes.$inferSelect;
export type InsertVisualProjectMode = typeof visualProjectModes.$inferInsert;

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

// ─── Document Groups (Multi-Page Documents) ─────────────────────────────────
// A logical document that may span multiple pages/images. Shared metadata lives here.

export const documentGroups = pgTable("document_groups", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 512 }).notNull(),
  sharedMetadata: jsonb("sharedMetadata"),  // { sender, recipient, date, origin_location, etc. }
  pageCount: integer("pageCount").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("dg_projectId_idx").on(t.projectId),
]);

export type DocumentGroup = typeof documentGroups.$inferSelect;
export type InsertDocumentGroup = typeof documentGroups.$inferInsert;

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
  // Multi-page support
  groupId: integer("groupId").references(() => documentGroups.id, { onDelete: "set null" }),
  pageNumber: integer("pageNumber"),  // 1-based page order within group
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
}, (t) => [
  index("documents_projectId_idx").on(t.projectId),
  index("documents_status_idx").on(t.status),
  index("documents_groupId_idx").on(t.groupId),
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

// ─── Gamification: Review Activities ────────────────────────────────────────
// Tracks individual XP-earning events (line approved, correction made, page completed, streak bonus).

export const activityTypeEnum = pgEnum("activity_type", [
  "line_approved", "line_corrected", "page_completed", "streak_bonus", "daily_login"
]);

export const reviewActivities = pgTable("review_activities", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: integer("documentId").references(() => documents.id, { onDelete: "set null" }),
  activityType: activityTypeEnum("activityType").notNull(),
  xpEarned: integer("xpEarned").notNull().default(0),
  metadata: jsonb("metadata"),  // { lineIndex, lineText, correctionDiff, etc. }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("ra_userId_idx").on(t.userId),
  index("ra_projectId_idx").on(t.projectId),
  index("ra_userId_projectId_idx").on(t.userId, t.projectId),
  index("ra_createdAt_idx").on(t.createdAt),
]);

export type ReviewActivity = typeof reviewActivities.$inferSelect;
export type InsertReviewActivity = typeof reviewActivities.$inferInsert;

// ─── Gamification: User XP Stats ────────────────────────────────────────────
// Aggregated per-user-per-project stats for fast leaderboard queries.

export const userXpStats = pgTable("user_xp_stats", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  totalXp: integer("totalXp").notNull().default(0),
  level: integer("level").notNull().default(0),
  linesReviewed: integer("linesReviewed").notNull().default(0),
  correctionsMade: integer("correctionsMade").notNull().default(0),
  pagesCompleted: integer("pagesCompleted").notNull().default(0),
  currentStreak: integer("currentStreak").notNull().default(0),
  longestStreak: integer("longestStreak").notNull().default(0),
  lastActiveDate: varchar("lastActiveDate", { length: 10 }),  // YYYY-MM-DD for streak tracking
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("uxs_userId_projectId_idx").on(t.userId, t.projectId),
  index("uxs_projectId_totalXp_idx").on(t.projectId, t.totalXp),
]);

export type UserXpStats = typeof userXpStats.$inferSelect;
export type InsertUserXpStats = typeof userXpStats.$inferInsert;

// ─── Review Sessions: Persistent state for Quick Review ─────────────────────
// Stores the user's current position in a review session so they can resume
// after reload, tab change, or browser close.

export const reviewSessions = pgTable("review_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mode: varchar("mode", { length: 20 }).notNull().default("classic"), // "classic" | "pyramid"
  currentDocumentId: integer("currentDocumentId").references(() => documents.id, { onDelete: "set null" }),
  currentLineIndex: integer("currentLineIndex").notNull().default(0),
  reviewedLines: jsonb("reviewedLines").notNull().default("{}"), // { [lineIndex]: { original, reviewed } }
  selectedLanguage: varchar("selectedLanguage", { length: 50 }).default(""),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("rs_userId_projectId_idx").on(t.userId, t.projectId),
]);

export type ReviewSession = typeof reviewSessions.$inferSelect;
export type InsertReviewSession = typeof reviewSessions.$inferInsert;

// ─── Validation Sessions (Sandboxed Review Portal) ─────────────────────────
// A validation session is created by the admin to validate AI accuracy on selected docs.
// Reviewers access via a shareable link with no OAuth — just a username.

export const validationSessionStatusEnum = pgEnum("validation_session_status", ["active", "closed"]);

export const validationSessions = pgTable("validation_sessions", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  shareToken: varchar("shareToken", { length: 64 }).notNull().unique(), // used in URL
  totalDocs: integer("totalDocs").notNull().default(0),
  reviewsPerDoc: integer("reviewsPerDoc").notNull().default(5),
  status: validationSessionStatusEnum("status").default("active").notNull(),
  documentIds: jsonb("documentIds").notNull(), // number[] — selected document IDs
  arabicOnly: boolean("arabicOnly").notNull().default(true), // filter to Arabic-text lines only
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
}, (t) => [
  index("vs_projectId_idx").on(t.projectId),
  index("vs_shareToken_idx").on(t.shareToken),
]);

export type ValidationSession = typeof validationSessions.$inferSelect;
export type InsertValidationSession = typeof validationSessions.$inferInsert;

// ─── Validation Assignments ─────────────────────────────────────────────────
// Tracks which reviewer is assigned which document. Max 5 unique reviewers per doc.

export const validationAssignmentStatusEnum = pgEnum("validation_assignment_status", ["in_progress", "completed"]);

export const validationAssignments = pgTable("validation_assignments", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull().references(() => validationSessions.id, { onDelete: "cascade" }),
  documentId: integer("documentId").notNull().references(() => documents.id, { onDelete: "cascade" }),
  reviewerUsername: varchar("reviewerUsername", { length: 100 }).notNull(),
  status: validationAssignmentStatusEnum("status").default("in_progress").notNull(),
  totalLines: integer("totalLines").notNull().default(0),
  linesReviewed: integer("linesReviewed").notNull().default(0),
  correctCount: integer("correctCount").notNull().default(0),
  incorrectCount: integer("incorrectCount").notNull().default(0),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (t) => [
  index("va_sessionId_idx").on(t.sessionId),
  index("va_documentId_idx").on(t.documentId),
  index("va_reviewer_idx").on(t.reviewerUsername),
  index("va_session_doc_reviewer_idx").on(t.sessionId, t.documentId, t.reviewerUsername),
]);

export type ValidationAssignment = typeof validationAssignments.$inferSelect;
export type InsertValidationAssignment = typeof validationAssignments.$inferInsert;

// ─── Validation Reviews (Line-Level Verdicts) ───────────────────────────────
// Each row = one reviewer's verdict on one line of one document.

export const validationVerdictEnum = pgEnum("validation_verdict", ["correct", "incorrect", "skipped"]);

export const validationReviews = pgTable("validation_reviews", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignmentId").notNull().references(() => validationAssignments.id, { onDelete: "cascade" }),
  sessionId: integer("sessionId").notNull().references(() => validationSessions.id, { onDelete: "cascade" }),
  documentId: integer("documentId").notNull().references(() => documents.id, { onDelete: "cascade" }),
  reviewerUsername: varchar("reviewerUsername", { length: 100 }).notNull(),
  lineIndex: integer("lineIndex").notNull(),
  lineText: text("lineText").notNull(),
  verdict: validationVerdictEnum("verdict").notNull(),
  incorrectWords: jsonb("incorrectWords"), // Array<{ wordIndex: number; word: string }> — which words were marked incorrect
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("vr_assignmentId_idx").on(t.assignmentId),
  index("vr_sessionId_idx").on(t.sessionId),
  index("vr_documentId_idx").on(t.documentId),
  index("vr_session_doc_line_idx").on(t.sessionId, t.documentId, t.lineIndex),
]);

export type ValidationReview = typeof validationReviews.$inferSelect;
export type InsertValidationReview = typeof validationReviews.$inferInsert;

// ─── Research Conversations (Codex Agent) ──────────────────────────────────
// Stores multi-turn research conversations with the Codex agent per project.

export const researchConversations = pgTable("research_conversations", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 512 }).notNull().default("New Research"),
  messages: jsonb("messages").notNull().default("[]"), // Array of { role, content, toolCalls?, toolResults?, visualizations? }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("rc_projectId_idx").on(t.projectId),
  index("rc_userId_idx").on(t.userId),
  index("rc_projectId_userId_idx").on(t.projectId, t.userId),
]);

export type ResearchConversation = typeof researchConversations.$inferSelect;
export type InsertResearchConversation = typeof researchConversations.$inferInsert;

// ─── Activity Log ────────────────────────────────────────────────────────────

export const activityActionEnum = pgEnum("activity_action", [
  "document_uploaded", "document_transcribed", "document_reviewed",
  "document_approved", "document_flagged", "document_assigned",
  "entity_created", "entity_merged", "entity_deleted",
  "validation_session_created", "validation_verdict_submitted",
  "project_member_invited", "project_member_joined",
  "batch_started", "batch_completed",
  "document_cross_checked",
]);

export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: integer("userId").references(() => users.id, { onDelete: "set null" }),
  action: activityActionEnum("action").notNull(),
  targetType: varchar("targetType", { length: 64 }), // "document", "entity", "session", etc.
  targetId: integer("targetId"),
  metadata: jsonb("metadata"), // flexible extra data (doc name, entity name, count, etc.)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("al_projectId_idx").on(t.projectId),
  index("al_projectId_createdAt_idx").on(t.projectId, t.createdAt),
  index("al_userId_idx").on(t.userId),
]);

export type ActivityLog = typeof activityLog.$inferSelect;
export type InsertActivityLog = typeof activityLog.$inferInsert;

// ─── Document Assignments ────────────────────────────────────────────────────

export const assignmentStatusEnum = pgEnum("assignment_status", ["pending", "in_progress", "completed"]);

export const documentAssignments = pgTable("document_assignments", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: integer("documentId").notNull().references(() => documents.id, { onDelete: "cascade" }),
  assigneeId: integer("assigneeId").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedBy: integer("assignedBy").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: assignmentStatusEnum("status").default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (t) => [
  index("da_projectId_idx").on(t.projectId),
  index("da_assigneeId_idx").on(t.assigneeId),
  index("da_documentId_idx").on(t.documentId),
  index("da_projectId_assigneeId_idx").on(t.projectId, t.assigneeId),
]);

export type DocumentAssignment = typeof documentAssignments.$inferSelect;
export type InsertDocumentAssignment = typeof documentAssignments.$inferInsert;

// ─── Visual Archives (VRA Core 4 MVP) ────────────────────────────────────────

export const visualAssets = pgTable("visual_assets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdByUserId: integer("createdByUserId").references(() => users.id, { onDelete: "set null" }),
  filename: varchar("filename", { length: 512 }).notNull(),
  mimeType: varchar("mimeType", { length: 64 }).notNull(),
  byteSize: integer("byteSize").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  width: integer("width"),
  height: integer("height"),
  originalKey: text("originalKey").notNull(),
  displayKey: text("displayKey"),
  thumbnailKey: text("thumbnailKey"),
  technicalMetadata: jsonb("technicalMetadata").default(sql`'{}'::jsonb`).notNull(),
  status: visualAssetStatusEnum("status").default("uploaded").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("visual_assets_projectId_idx").on(t.projectId),
  index("visual_assets_projectId_status_idx").on(t.projectId, t.status),
  index("visual_assets_project_status_created_id_idx").on(t.projectId, t.status, t.createdAt, t.id),
  index("visual_assets_projectId_sha256_idx").on(t.projectId, t.sha256),
  uniqueIndex("visual_assets_projectId_id_uq").on(t.projectId, t.id),
]);

export type VisualAsset = typeof visualAssets.$inferSelect;
export type InsertVisualAsset = typeof visualAssets.$inferInsert;

export const vraRecords = pgTable("vra_records", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  recordType: vraRecordTypeEnum("recordType").notNull(),
  status: vraRecordStatusEnum("status").default("draft").notNull(),
  title: varchar("title", { length: 1024 }).notNull(),
  localIdentifier: varchar("localIdentifier", { length: 255 }),
  assetId: uuid("assetId"),
  reviewedJson: jsonb("reviewedJson").default(sql`'{}'::jsonb`).notNull(),
  aiSuggestedJson: jsonb("aiSuggestedJson").default(sql`'{}'::jsonb`).notNull(),
  suggestionProvenance: jsonb("suggestionProvenance").default(sql`'{}'::jsonb`).notNull(),
  revision: integer("revision").default(1).notNull(),
  createdByUserId: integer("createdByUserId").references(() => users.id, { onDelete: "set null" }),
  updatedByUserId: integer("updatedByUserId").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: integer("approvedByUserId").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("vra_records_projectId_idx").on(t.projectId),
  index("vra_records_projectId_type_idx").on(t.projectId, t.recordType),
  index("vra_records_projectId_status_idx").on(t.projectId, t.status),
  index("vra_records_project_status_updated_id_idx").on(t.projectId, t.status, t.updatedAt, t.id),
  index("vra_records_project_type_status_updated_id_idx").on(t.projectId, t.recordType, t.status, t.updatedAt, t.id),
  index("vra_records_projectId_assetId_idx").on(t.projectId, t.assetId),
  uniqueIndex("vra_records_projectId_id_uq").on(t.projectId, t.id),
  foreignKey({
    columns: [t.projectId, t.assetId],
    foreignColumns: [visualAssets.projectId, visualAssets.id],
    name: "vra_records_project_asset_fk",
  }).onDelete("restrict"),
]);

export type VraRecord = typeof vraRecords.$inferSelect;
export type InsertVraRecord = typeof vraRecords.$inferInsert;

export const vraRecordRelations = pgTable("vra_record_relations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceRecordId: uuid("sourceRecordId").notNull(),
  targetRecordId: uuid("targetRecordId").notNull(),
  relationType: varchar("relationType", { length: 128 }).notNull(),
  status: vraRelationStatusEnum("status").default("approved").notNull(),
  evidenceJson: jsonb("evidenceJson").default(sql`'{}'::jsonb`).notNull(),
  createdByUserId: integer("createdByUserId").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: integer("approvedByUserId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (t) => [
  index("vra_relations_projectId_idx").on(t.projectId),
  index("vra_relations_source_idx").on(t.projectId, t.sourceRecordId),
  index("vra_relations_target_idx").on(t.projectId, t.targetRecordId),
  uniqueIndex("vra_relations_project_source_target_type_uq").on(t.projectId, t.sourceRecordId, t.targetRecordId, t.relationType),
  foreignKey({
    columns: [t.projectId, t.sourceRecordId],
    foreignColumns: [vraRecords.projectId, vraRecords.id],
    name: "vra_relations_source_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.projectId, t.targetRecordId],
    foreignColumns: [vraRecords.projectId, vraRecords.id],
    name: "vra_relations_target_fk",
  }).onDelete("cascade"),
]);

export type VraRecordRelation = typeof vraRecordRelations.$inferSelect;
export type InsertVraRecordRelation = typeof vraRecordRelations.$inferInsert;

export const vraRecordRevisions = pgTable("vra_record_revisions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: integer("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  recordId: uuid("recordId").notNull(),
  revision: integer("revision").notNull(),
  snapshotJson: jsonb("snapshotJson").notNull(),
  changeSummary: text("changeSummary"),
  createdByUserId: integer("createdByUserId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("vra_revisions_projectId_recordId_idx").on(t.projectId, t.recordId),
  uniqueIndex("vra_revisions_project_record_revision_uq").on(t.projectId, t.recordId, t.revision),
  foreignKey({
    columns: [t.projectId, t.recordId],
    foreignColumns: [vraRecords.projectId, vraRecords.id],
    name: "vra_revisions_record_fk",
  }).onDelete("cascade"),
]);

export type VraRecordRevision = typeof vraRecordRevisions.$inferSelect;
export type InsertVraRecordRevision = typeof vraRecordRevisions.$inferInsert;
