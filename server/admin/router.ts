import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { isPlatformOwner } from "../../shared/admin";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  overviewQuery,
  trendQuery,
  usersQuery,
  userFilter,
  projectsQuery,
  projectFilter,
  membersQuery,
  memberCountQuery,
  type Metrics,
} from "./queries";

const ownerProcedure = protectedProcedure.use(({ ctx, next }) => {
  // ctx.user is loaded from the DB by the authenticated server context. Never
  // trust a client email, role flag, URL parameter or the generic admin role.
  if (!isPlatformOwner(ctx.user.email))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This dashboard is restricted to the platform owner.",
    });
  ctx.res.setHeader("Cache-Control", "private, no-store");
  return next({ ctx });
});

async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Metrics are temporarily unavailable. Please retry.",
    });
  return db;
}

const pagination = {
  page: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(50).default(25),
};
const search = z.string().trim().max(200).default("");
type Overview = Metrics & {
  projects: number;
  visualProjects: number;
  activeProjects: number;
  users: number;
  newUsers30: number;
  signedIn30: number;
  signedIn7: number;
  cappedUsers: number;
};
type UserRow = {
  id: number;
  name: string | null;
  email: string | null;
  plan: string;
  createdAt: string;
  lastSignedIn: string;
  documentQuotaUsed: number;
  projects: number;
  sharedProjects: number;
  documents: number;
  assets: number;
  transcriptions: number;
  bytes: number;
};
type ProjectRow = Metrics & {
  id: number;
  userId: number;
  name: string;
  status: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
  members: number;
  ownerName: string | null;
  ownerEmail: string | null;
  userRole: string | null;
};

export const adminRouter = router({
  access: protectedProcedure.query(({ ctx }) => ({
    allowed: isPlatformOwner(ctx.user.email),
  })),
  overview: ownerProcedure.query(async () => {
    const db = await database();
    return db.transaction(
      async tx => {
        const [totals] = await tx.execute<Overview>(overviewQuery);
        const trend = await tx.execute<{
          day: string;
          signups: number;
          projects: number;
          documents: number;
          images: number;
        }>(trendQuery);
        return {
          totals,
          trend: Array.from(trend),
          generatedAt: new Date().toISOString(),
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" }
    );
  }),
  users: ownerProcedure
    .input(
      z.object({
        ...pagination,
        search,
        cappedOnly: z.boolean().default(false),
      })
    )
    .query(async ({ input }) => {
      const db = await database();
      return db.transaction(
        async tx => {
          const [count] = await tx.execute<{ total: number }>(
            sql`select count(*)::float8 total from users u where ${userFilter(input.search, input.cappedOnly)}`
          );
          const rows = await tx.execute<UserRow>(
            usersQuery(input.search, input.cappedOnly, input.page, input.limit)
          );
          return { rows: Array.from(rows), total: count.total };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" }
      );
    }),
  projects: ownerProcedure
    .input(
      z.object({
        ...pagination,
        search,
        userId: z.number().int().positive().optional(),
        mode: z
          .enum(["all", "document_transcription", "visual_vra"])
          .default("all"),
      })
    )
    .query(async ({ input }) => {
      const db = await database();
      return db.transaction(
        async tx => {
          const [count] = await tx.execute<{ total: number }>(
            sql`select count(*)::float8 total from projects p where ${projectFilter(input.userId, input.search, input.mode)}`
          );
          const rows = await tx.execute<ProjectRow>(
            projectsQuery(
              input.userId,
              input.search,
              input.mode,
              input.page,
              input.limit
            )
          );
          return { rows: Array.from(rows), total: count.total };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" }
      );
    }),
  members: ownerProcedure
    .input(z.object({ ...pagination, projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await database();
      return db.transaction(
        async tx => {
          const [count] = await tx.execute<{ total: number }>(
            memberCountQuery(input.projectId)
          );
          const rows = await tx.execute<{
            id: number;
            name: string | null;
            email: string | null;
            role: string;
            total: number;
          }>(membersQuery(input.projectId, input.page, input.limit));
          return { rows: Array.from(rows), total: count.total };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" }
      );
    }),
});
