import { and, eq, sql } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";

export const PRESENTATION_DOCUMENT_LIMIT = 20;
export const PRESENTATION_CONTACT_EMAIL = "adamamin2027@gmail.com";

export const PRESENTATION_LIMIT_MESSAGE =
  `You've reached the ${PRESENTATION_DOCUMENT_LIMIT}-document demo limit. ` +
  `Email ${PRESENTATION_CONTACT_EMAIL} for additional use.`;

export function isPresentationUsageExempt(email?: string | null): boolean {
  return email?.trim().toLowerCase() === PRESENTATION_CONTACT_EMAIL;
}

export function getPresentationUsageState(email: string | null | undefined, used: number) {
  const normalizedUsed = Math.max(0, Math.trunc(used || 0));
  const isExempt = isPresentationUsageExempt(email);

  return {
    isExempt,
    used: normalizedUsed,
    limit: isExempt ? null : PRESENTATION_DOCUMENT_LIMIT,
    remaining: isExempt ? null : Math.max(0, PRESENTATION_DOCUMENT_LIMIT - normalizedUsed),
  };
}

export class PresentationUsageLimitError extends Error {
  constructor() {
    super(PRESENTATION_LIMIT_MESSAGE);
    this.name = "PresentationUsageLimitError";
  }
}

/**
 * Atomically reserves AI document-processing uses before provider work begins.
 * The conditional update prevents concurrent requests from overshooting the cap.
 * Adam's presentation account is explicitly exempt.
 */
export async function reservePresentationDocumentUsage(input: {
  userId: number;
  email?: string | null;
  count?: number;
}) {
  const count = input.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Document usage reservation count must be a positive integer");
  }

  if (isPresentationUsageExempt(input.email)) {
    return { isExempt: true as const, used: null, remaining: null };
  }

  const db = await getDb();
  if (!db) {
    // Fail closed: an unavailable counter must never turn into unmetered AI spend.
    throw new Error("Document usage could not be verified. Please try again shortly.");
  }

  const [updated] = await db
    .update(users)
    .set({
      documentQuotaUsed: sql`${users.documentQuotaUsed} + ${count}`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(users.id, input.userId),
      sql`${users.documentQuotaUsed} + ${count} <= ${PRESENTATION_DOCUMENT_LIMIT}`,
    ))
    .returning({ used: users.documentQuotaUsed });

  if (!updated) throw new PresentationUsageLimitError();

  return {
    isExempt: false as const,
    used: updated.used,
    remaining: Math.max(0, PRESENTATION_DOCUMENT_LIMIT - updated.used),
  };
}
