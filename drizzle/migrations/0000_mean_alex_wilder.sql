CREATE TYPE "public"."document_status" AS ENUM('pending', 'processing', 'needs_review', 'reviewed', 'flagged', 'error');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('transcribe', 'batch_transcribe', 'validate_config');--> statement-breakpoint
CREATE TYPE "public"."pipeline_type" AS ENUM('single_pass', 'two_pass');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('onboarding', 'validating', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "document_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projectId" integer NOT NULL,
	"documentId" integer NOT NULL,
	"transcriptionId" integer,
	"content" text NOT NULL,
	"metadata" jsonb,
	"embedding" vector(768),
	"createdAt" timestamp DEFAULT now() NOT NULL
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
	"uploadedAt" timestamp DEFAULT now() NOT NULL,
	"processedAt" timestamp
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
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_transcriptionId_transcriptions_id_fk" FOREIGN KEY ("transcriptionId") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_samples" ADD CONSTRAINT "onboarding_samples_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddings_projectId_idx" ON "document_embeddings" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "embeddings_documentId_idx" ON "document_embeddings" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "documents_projectId_idx" ON "documents" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_projectId_idx" ON "jobs" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "samples_projectId_idx" ON "onboarding_samples" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "projects_userId_idx" ON "projects" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "transcriptions_documentId_idx" ON "transcriptions" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "transcriptions_projectId_idx" ON "transcriptions" USING btree ("projectId");