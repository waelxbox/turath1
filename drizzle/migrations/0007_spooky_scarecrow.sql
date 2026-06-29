CREATE TYPE "public"."validation_assignment_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."validation_session_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."validation_verdict" AS ENUM('correct', 'incorrect', 'skipped');--> statement-breakpoint
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
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"closedAt" timestamp,
	CONSTRAINT "validation_sessions_shareToken_unique" UNIQUE("shareToken")
);
--> statement-breakpoint
ALTER TABLE "research_conversations" ADD CONSTRAINT "research_conversations_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_conversations" ADD CONSTRAINT "research_conversations_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_assignments" ADD CONSTRAINT "validation_assignments_sessionId_validation_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."validation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_assignments" ADD CONSTRAINT "validation_assignments_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_reviews" ADD CONSTRAINT "validation_reviews_assignmentId_validation_assignments_id_fk" FOREIGN KEY ("assignmentId") REFERENCES "public"."validation_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_reviews" ADD CONSTRAINT "validation_reviews_sessionId_validation_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."validation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_reviews" ADD CONSTRAINT "validation_reviews_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_sessions" ADD CONSTRAINT "validation_sessions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rc_projectId_idx" ON "research_conversations" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "rc_userId_idx" ON "research_conversations" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "rc_projectId_userId_idx" ON "research_conversations" USING btree ("projectId","userId");--> statement-breakpoint
CREATE INDEX "va_sessionId_idx" ON "validation_assignments" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "va_documentId_idx" ON "validation_assignments" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "va_reviewer_idx" ON "validation_assignments" USING btree ("reviewerUsername");--> statement-breakpoint
CREATE INDEX "va_session_doc_reviewer_idx" ON "validation_assignments" USING btree ("sessionId","documentId","reviewerUsername");--> statement-breakpoint
CREATE INDEX "vr_assignmentId_idx" ON "validation_reviews" USING btree ("assignmentId");--> statement-breakpoint
CREATE INDEX "vr_sessionId_idx" ON "validation_reviews" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "vr_documentId_idx" ON "validation_reviews" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "vr_session_doc_line_idx" ON "validation_reviews" USING btree ("sessionId","documentId","lineIndex");--> statement-breakpoint
CREATE INDEX "vs_projectId_idx" ON "validation_sessions" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "vs_shareToken_idx" ON "validation_sessions" USING btree ("shareToken");