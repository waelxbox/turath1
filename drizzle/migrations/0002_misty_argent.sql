CREATE TYPE "public"."merge_suggestion_status" AS ENUM('pending', 'accepted', 'rejected', 'skipped');--> statement-breakpoint
CREATE TABLE "entity_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"entityId" integer NOT NULL,
	"alias" varchar(512) NOT NULL,
	"normalizedAlias" varchar(512),
	"language" varchar(32),
	"createdAt" timestamp DEFAULT now() NOT NULL
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
ALTER TABLE "entities" ADD COLUMN "canonicalId" integer;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entityId_entities_id_fk" FOREIGN KEY ("entityId") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_suggestions" ADD CONSTRAINT "merge_suggestions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ea_entityId_idx" ON "entity_aliases" USING btree ("entityId");--> statement-breakpoint
CREATE INDEX "ea_normalizedAlias_idx" ON "entity_aliases" USING btree ("normalizedAlias");--> statement-breakpoint
CREATE INDEX "ms_projectId_idx" ON "merge_suggestions" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "ms_status_idx" ON "merge_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "entities_canonicalId_idx" ON "entities" USING btree ("canonicalId");