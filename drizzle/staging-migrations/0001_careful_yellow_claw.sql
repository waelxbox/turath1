CREATE TABLE "stripe_webhook_events" (
	"eventId" varchar(255) PRIMARY KEY NOT NULL,
	"eventType" varchar(255) NOT NULL,
	"stripeCreatedAt" integer NOT NULL,
	"processedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_queue_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"documentId" integer NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 3 NOT NULL,
	"availableAt" timestamp DEFAULT now() NOT NULL,
	"leaseOwner" varchar(160),
	"leaseExpiresAt" timestamp,
	"heartbeatAt" timestamp,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "transcriptions_documentId_idx";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processingStartedAt" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripeSubscriptionId" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripeSubscriptionStatus" "subscription_status";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lastStripeEventCreatedAt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pendingStripeCheckoutLockId" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pendingStripeCheckoutSessionId" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pendingStripeCheckoutExpiresAt" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "transcriptionQuotaUsed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quotaPeriodStartedAt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "demoProjectCreatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "transcription_queue_tasks" ADD CONSTRAINT "transcription_queue_tasks_jobId_jobs_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_queue_tasks" ADD CONSTRAINT "transcription_queue_tasks_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_queue_tasks" ADD CONSTRAINT "transcription_queue_tasks_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transcription_queue_project_document_uq" ON "transcription_queue_tasks" USING btree ("projectId","documentId");--> statement-breakpoint
CREATE INDEX "transcription_queue_claim_idx" ON "transcription_queue_tasks" USING btree ("status","availableAt","createdAt");--> statement-breakpoint
CREATE INDEX "transcription_queue_project_status_idx" ON "transcription_queue_tasks" USING btree ("projectId","status");--> statement-breakpoint
CREATE INDEX "transcription_queue_lease_idx" ON "transcription_queue_tasks" USING btree ("status","leaseExpiresAt");--> statement-breakpoint
CREATE INDEX "transcription_queue_job_idx" ON "transcription_queue_tasks" USING btree ("jobId");--> statement-breakpoint
CREATE UNIQUE INDEX "transcriptions_documentId_unique" ON "transcriptions" USING btree ("documentId");--> statement-breakpoint
CREATE UNIQUE INDEX "users_stripeCustomerId_unique" ON "users" USING btree ("stripeCustomerId") WHERE "users"."stripeCustomerId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_stripeSubscriptionId_unique" ON "users" USING btree ("stripeSubscriptionId") WHERE "users"."stripeSubscriptionId" IS NOT NULL;