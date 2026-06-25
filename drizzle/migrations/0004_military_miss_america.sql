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
ALTER TABLE "documents" ADD COLUMN "groupId" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "pageNumber" integer;--> statement-breakpoint
ALTER TABLE "document_groups" ADD CONSTRAINT "document_groups_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dg_projectId_idx" ON "document_groups" USING btree ("projectId");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_groupId_document_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."document_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_groupId_idx" ON "documents" USING btree ("groupId");