CREATE TYPE "public"."activity_type" AS ENUM('line_approved', 'line_corrected', 'page_completed', 'streak_bonus', 'daily_login');--> statement-breakpoint
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
ALTER TABLE "review_activities" ADD CONSTRAINT "review_activities_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_activities" ADD CONSTRAINT "review_activities_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_activities" ADD CONSTRAINT "review_activities_documentId_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_xp_stats" ADD CONSTRAINT "user_xp_stats_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_xp_stats" ADD CONSTRAINT "user_xp_stats_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ra_userId_idx" ON "review_activities" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ra_projectId_idx" ON "review_activities" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "ra_userId_projectId_idx" ON "review_activities" USING btree ("userId","projectId");--> statement-breakpoint
CREATE INDEX "ra_createdAt_idx" ON "review_activities" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "uxs_userId_projectId_idx" ON "user_xp_stats" USING btree ("userId","projectId");--> statement-breakpoint
CREATE INDEX "uxs_projectId_totalXp_idx" ON "user_xp_stats" USING btree ("projectId","totalXp");