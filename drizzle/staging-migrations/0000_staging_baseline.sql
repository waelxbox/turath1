-- Required by document_embeddings.embedding. On managed PostgreSQL (including
-- Supabase), enable the extension in the dashboard first if the migration role
-- is not permitted to create extensions.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."activity_action" AS ENUM('document_uploaded', 'document_transcribed', 'document_reviewed', 'document_approved', 'document_flagged', 'document_assigned', 'entity_created', 'entity_merged', 'entity_deleted', 'validation_session_created', 'validation_verdict_submitted', 'project_member_invited', 'project_member_joined', 'batch_started', 'batch_completed', 'document_cross_checked');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('line_approved', 'line_corrected', 'page_completed', 'streak_bonus', 'daily_login');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'processing', 'needs_review', 'reviewed', 'flagged', 'error');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('person', 'location', 'organization');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'expired');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('transcribe', 'batch_transcribe', 'validate_config', 'entity_merge');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."merge_suggestion_status" AS ENUM('pending', 'accepted', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."pipeline_type" AS ENUM('single_pass', 'two_pass');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro', 'team', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('onboarding', 'validating', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'canceled', 'past_due', 'trialing');--> statement-breakpoint
CREATE TYPE "public"."validation_assignment_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."validation_session_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."validation_verdict" AS ENUM('correct', 'incorrect', 'skipped');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"userId" integer,
	"action" "activity_action" NOT NULL,
	"targetType" varchar(64),
	"targetId" integer,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"documentId" integer NOT NULL,
	"assigneeId" integer NOT NULL,
	"assignedBy" integer NOT NULL,
	"status" "assignment_status" DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "document_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" integer NOT NULL,
	"documentId" integer NOT NULL,
	"transcriptionId" integer,
	"content" text NOT NULL,
	"metadata" jsonb,
	"embedding" vector(3072),
	"content_tsv" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"documentId" integer NOT NULL,
	"entityId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"contextSnippet" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"title" varchar(512) NOT NULL,
	"sharedMetadata" jsonb,
	"pageCount" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"filename" varchar(255) NOT NULL,
	"storagePath" text NOT NULL,
	"storageUrl" text,
	"mimeType" varchar(64) DEFAULT 'image/jpeg',
	"fileSizeBytes" integer,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"errorMessage" text,
	"groupId" integer,
	"pageNumber" integer,
	"uploadedAt" timestamp DEFAULT now() NOT NULL,
	"processedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"name" varchar(512) NOT NULL,
	"type" "entity_type" NOT NULL,
	"normalizedName" varchar(512),
	"canonicalId" integer,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"entityId" integer NOT NULL,
	"alias" varchar(512) NOT NULL,
	"normalizedAlias" varchar(512),
	"language" varchar(32),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"documentId" integer,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0,
	"totalItems" integer DEFAULT 1,
	"completedItems" integer DEFAULT 0,
	"errorMessage" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merge_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"status" "merge_suggestion_status" DEFAULT 'pending' NOT NULL,
	"suggestedCanonical" varchar(512) NOT NULL,
	"confidence" varchar(16) NOT NULL,
	"entityIds" jsonb NOT NULL,
	"reasoning" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"reviewedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "onboarding_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"imagePath" text NOT NULL,
	"imageUrl" text,
	"filename" varchar(255),
	"manualTranscription" jsonb NOT NULL,
	"aiOutput" jsonb,
	"validationScore" real,
	"isHeldOut" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"invitedByUserId" integer NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" "member_role" DEFAULT 'editor' NOT NULL,
	"token" varchar(64) NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	CONSTRAINT "project_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"userId" integer NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"addedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'onboarding' NOT NULL,
	"modelProvider" varchar(64) DEFAULT 'gemini' NOT NULL,
	"modelName" varchar(128) DEFAULT 'gemini-2.5-flash' NOT NULL,
	"pipelineType" "pipeline_type" DEFAULT 'single_pass' NOT NULL,
	"temperature" real DEFAULT 0.1 NOT NULL,
	"maxTokens" integer DEFAULT 4096 NOT NULL,
	"systemPrompt" text,
	"pass2Prompt" text,
	"jsonSchema" jsonb,
	"glossary" jsonb,
	"postProcessing" jsonb,
	"outputFormats" jsonb,
	"onboardingReasoning" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"userId" integer NOT NULL,
	"title" varchar(512) DEFAULT 'New Research' NOT NULL,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"documentId" integer,
	"activityType" "activity_type" NOT NULL,
	"xpEarned" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"mode" varchar(20) DEFAULT 'classic' NOT NULL,
	"currentDocumentId" integer,
	"currentLineIndex" integer DEFAULT 0 NOT NULL,
	"reviewedLines" jsonb DEFAULT '{}' NOT NULL,
	"selectedLanguage" varchar(50) DEFAULT '',
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"documentId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"modelUsed" varchar(128) NOT NULL,
	"rawJson" jsonb NOT NULL,
	"reviewedJson" jsonb,
	"originalText" text,
	"confidenceNotes" text,
	"reviewedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_xp_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"totalXp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"linesReviewed" integer DEFAULT 0 NOT NULL,
	"correctionsMade" integer DEFAULT 0 NOT NULL,
	"pagesCompleted" integer DEFAULT 0 NOT NULL,
	"currentStreak" integer DEFAULT 0 NOT NULL,
	"longestStreak" integer DEFAULT 0 NOT NULL,
	"lastActiveDate" varchar(10),
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"stripeCustomerId" varchar(255),
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"documentQuotaUsed" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "validation_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"documentId" integer NOT NULL,
	"reviewerUsername" varchar(100) NOT NULL,
	"status" "validation_assignment_status" DEFAULT 'in_progress' NOT NULL,
	"totalLines" integer DEFAULT 0 NOT NULL,
	"linesReviewed" integer DEFAULT 0 NOT NULL,
	"correctCount" integer DEFAULT 0 NOT NULL,
	"incorrectCount" integer DEFAULT 0 NOT NULL,
	"assignedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "validation_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignmentId" integer NOT NULL,
	"sessionId" integer NOT NULL,
	"documentId" integer NOT NULL,
	"reviewerUsername" varchar(100) NOT NULL,
	"lineIndex" integer NOT NULL,
	"lineText" text NOT NULL,
	"verdict" "validation_verdict" NOT NULL,
	"incorrectWords" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"shareToken" varchar(64) NOT NULL,
	"totalDocs" integer DEFAULT 0 NOT NULL,
	"reviewsPerDoc" integer DEFAULT 5 NOT NULL,
	"status" "validation_session_status" DEFAULT 'active' NOT NULL,
	"documentIds" jsonb NOT NULL,
	"arabicOnly" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"closedAt" timestamp,
	CONSTRAINT "validation_sessions_shareToken_unique" UNIQUE("shareToken")
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_assigneeId_users_id_fk" FOREIGN KEY ("assigneeId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_assignedBy_users_id_fk" FOREIGN KEY ("assignedBy") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_transcriptionId_transcriptions_id_fk" FOREIGN KEY ("transcriptionId") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_entityId_entities_id_fk" FOREIGN KEY ("entityId") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_groups" ADD CONSTRAINT "document_groups_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_groupId_document_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."document_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entityId_entities_id_fk" FOREIGN KEY ("entityId") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_suggestions" ADD CONSTRAINT "merge_suggestions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_samples" ADD CONSTRAINT "onboarding_samples_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_invitedByUserId_users_id_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_conversations" ADD CONSTRAINT "research_conversations_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_conversations" ADD CONSTRAINT "research_conversations_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_activities" ADD CONSTRAINT "review_activities_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_activities" ADD CONSTRAINT "review_activities_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_activities" ADD CONSTRAINT "review_activities_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_currentDocumentId_documents_id_fk" FOREIGN KEY ("currentDocumentId") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_xp_stats" ADD CONSTRAINT "user_xp_stats_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_xp_stats" ADD CONSTRAINT "user_xp_stats_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_assignments" ADD CONSTRAINT "validation_assignments_sessionId_validation_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."validation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_assignments" ADD CONSTRAINT "validation_assignments_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_reviews" ADD CONSTRAINT "validation_reviews_assignmentId_validation_assignments_id_fk" FOREIGN KEY ("assignmentId") REFERENCES "public"."validation_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_reviews" ADD CONSTRAINT "validation_reviews_sessionId_validation_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."validation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_reviews" ADD CONSTRAINT "validation_reviews_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_sessions" ADD CONSTRAINT "validation_sessions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "al_projectId_idx" ON "activity_log" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "al_projectId_createdAt_idx" ON "activity_log" USING btree ("projectId","createdAt");--> statement-breakpoint
CREATE INDEX "al_userId_idx" ON "activity_log" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "da_projectId_idx" ON "document_assignments" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "da_assigneeId_idx" ON "document_assignments" USING btree ("assigneeId");--> statement-breakpoint
CREATE INDEX "da_documentId_idx" ON "document_assignments" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "da_projectId_assigneeId_idx" ON "document_assignments" USING btree ("projectId","assigneeId");--> statement-breakpoint
CREATE INDEX "embeddings_projectId_idx" ON "document_embeddings" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "embeddings_documentId_idx" ON "document_embeddings" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "embeddings_content_tsv_idx" ON "document_embeddings" USING gin (("content_tsv"::tsvector));--> statement-breakpoint
CREATE INDEX "docent_documentId_idx" ON "document_entities" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "docent_entityId_idx" ON "document_entities" USING btree ("entityId");--> statement-breakpoint
CREATE INDEX "docent_projectId_idx" ON "document_entities" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "dg_projectId_idx" ON "document_groups" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "documents_projectId_idx" ON "documents" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_groupId_idx" ON "documents" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "entities_projectId_idx" ON "entities" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "entities_name_type_idx" ON "entities" USING btree ("projectId","normalizedName","type");--> statement-breakpoint
CREATE INDEX "entities_canonicalId_idx" ON "entities" USING btree ("canonicalId");--> statement-breakpoint
CREATE INDEX "ea_entityId_idx" ON "entity_aliases" USING btree ("entityId");--> statement-breakpoint
CREATE INDEX "ea_normalizedAlias_idx" ON "entity_aliases" USING btree ("normalizedAlias");--> statement-breakpoint
CREATE INDEX "jobs_projectId_idx" ON "jobs" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ms_projectId_idx" ON "merge_suggestions" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "ms_status_idx" ON "merge_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "samples_projectId_idx" ON "onboarding_samples" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "pi_projectId_idx" ON "project_invites" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "pi_email_idx" ON "project_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "pi_token_idx" ON "project_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "pm_projectId_idx" ON "project_members" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "pm_userId_idx" ON "project_members" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_project_user_unique" ON "project_members" USING btree ("projectId","userId");--> statement-breakpoint
CREATE INDEX "projects_userId_idx" ON "projects" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "rc_projectId_idx" ON "research_conversations" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "rc_userId_idx" ON "research_conversations" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "rc_projectId_userId_idx" ON "research_conversations" USING btree ("projectId","userId");--> statement-breakpoint
CREATE INDEX "ra_userId_idx" ON "review_activities" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ra_projectId_idx" ON "review_activities" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "ra_userId_projectId_idx" ON "review_activities" USING btree ("userId","projectId");--> statement-breakpoint
CREATE INDEX "ra_createdAt_idx" ON "review_activities" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "rs_user_project_unique" ON "review_sessions" USING btree ("userId","projectId");--> statement-breakpoint
CREATE INDEX "transcriptions_documentId_idx" ON "transcriptions" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "transcriptions_projectId_idx" ON "transcriptions" USING btree ("projectId");--> statement-breakpoint
CREATE UNIQUE INDEX "uxs_user_project_unique" ON "user_xp_stats" USING btree ("userId","projectId");--> statement-breakpoint
CREATE INDEX "uxs_projectId_totalXp_idx" ON "user_xp_stats" USING btree ("projectId","totalXp");--> statement-breakpoint
CREATE INDEX "va_sessionId_idx" ON "validation_assignments" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "va_documentId_idx" ON "validation_assignments" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "va_reviewer_idx" ON "validation_assignments" USING btree ("reviewerUsername");--> statement-breakpoint
CREATE UNIQUE INDEX "va_session_doc_reviewer_unique" ON "validation_assignments" USING btree ("sessionId","documentId","reviewerUsername");--> statement-breakpoint
CREATE INDEX "vr_assignmentId_idx" ON "validation_reviews" USING btree ("assignmentId");--> statement-breakpoint
CREATE INDEX "vr_sessionId_idx" ON "validation_reviews" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "vr_documentId_idx" ON "validation_reviews" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "vr_session_doc_line_idx" ON "validation_reviews" USING btree ("sessionId","documentId","lineIndex");--> statement-breakpoint
CREATE UNIQUE INDEX "vr_assignment_line_unique" ON "validation_reviews" USING btree ("assignmentId","lineIndex");--> statement-breakpoint
CREATE INDEX "vs_projectId_idx" ON "validation_sessions" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "vs_shareToken_idx" ON "validation_sessions" USING btree ("shareToken");
