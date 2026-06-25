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
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_currentDocumentId_documents_id_fk" FOREIGN KEY ("currentDocumentId") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rs_userId_projectId_idx" ON "review_sessions" USING btree ("userId","projectId");