CREATE TYPE "public"."activity_action" AS ENUM('document_uploaded', 'document_transcribed', 'document_reviewed', 'document_approved', 'document_flagged', 'document_assigned', 'entity_created', 'entity_merged', 'entity_deleted', 'validation_session_created', 'validation_verdict_submitted', 'project_member_invited', 'project_member_joined', 'batch_started', 'batch_completed');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
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
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_assigneeId_users_id_fk" FOREIGN KEY ("assigneeId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assignments" ADD CONSTRAINT "document_assignments_assignedBy_users_id_fk" FOREIGN KEY ("assignedBy") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "al_projectId_idx" ON "activity_log" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "al_projectId_createdAt_idx" ON "activity_log" USING btree ("projectId","createdAt");--> statement-breakpoint
CREATE INDEX "al_userId_idx" ON "activity_log" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "da_projectId_idx" ON "document_assignments" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "da_assigneeId_idx" ON "document_assignments" USING btree ("assigneeId");--> statement-breakpoint
CREATE INDEX "da_documentId_idx" ON "document_assignments" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "da_projectId_assigneeId_idx" ON "document_assignments" USING btree ("projectId","assigneeId");