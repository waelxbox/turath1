CREATE TYPE "public"."entity_type" AS ENUM('person', 'location', 'organization');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'expired');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "document_entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"documentId" integer NOT NULL,
	"entityId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"contextSnippet" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"name" varchar(512) NOT NULL,
	"type" "entity_type" NOT NULL,
	"normalizedName" varchar(512),
	"metadata" jsonb,
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
ALTER TABLE "document_embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(3072);--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD COLUMN "content_tsv" text;--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_entityId_entities_id_fk" FOREIGN KEY ("entityId") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_invitedByUserId_users_id_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "docent_documentId_idx" ON "document_entities" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "docent_entityId_idx" ON "document_entities" USING btree ("entityId");--> statement-breakpoint
CREATE INDEX "docent_projectId_idx" ON "document_entities" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "entities_projectId_idx" ON "entities" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "entities_name_type_idx" ON "entities" USING btree ("projectId","normalizedName","type");--> statement-breakpoint
CREATE INDEX "pi_projectId_idx" ON "project_invites" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "pi_email_idx" ON "project_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "pi_token_idx" ON "project_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "pm_projectId_idx" ON "project_members" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "pm_userId_idx" ON "project_members" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "pm_project_user_idx" ON "project_members" USING btree ("projectId","userId");