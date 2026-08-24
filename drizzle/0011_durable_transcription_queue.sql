ALTER TABLE "documents" ADD COLUMN "processingStartedAt" timestamp;
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
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transcription_queue_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "transcription_queue_max_attempts_check" CHECK ("maxAttempts" > 0),
	CONSTRAINT "transcription_queue_attempt_limit_check" CHECK ("attempts" <= "maxAttempts")
);
--> statement-breakpoint
ALTER TABLE "transcription_queue_tasks" ADD CONSTRAINT "transcription_queue_tasks_jobId_jobs_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transcription_queue_tasks" ADD CONSTRAINT "transcription_queue_tasks_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transcription_queue_tasks" ADD CONSTRAINT "transcription_queue_tasks_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "transcription_queue_project_document_uq" ON "transcription_queue_tasks" USING btree ("projectId", "documentId");
--> statement-breakpoint
CREATE INDEX "transcription_queue_claim_idx" ON "transcription_queue_tasks" USING btree ("status", "availableAt", "createdAt");
--> statement-breakpoint
CREATE INDEX "transcription_queue_project_status_idx" ON "transcription_queue_tasks" USING btree ("projectId", "status");
--> statement-breakpoint
CREATE INDEX "transcription_queue_lease_idx" ON "transcription_queue_tasks" USING btree ("status", "leaseExpiresAt");
--> statement-breakpoint
CREATE INDEX "transcription_queue_job_idx" ON "transcription_queue_tasks" USING btree ("jobId");
