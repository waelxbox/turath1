import { and, desc, eq } from "drizzle-orm";
import { projects, vraRecords } from "../drizzle/schema";
import { ENV } from "../server/_core/env";
import { getDb, getUserByEmail, getUserByOpenId } from "../server/db";
import { getVraRecord } from "../server/visualArchives/db";
import { visualArchivesRouter } from "../server/visualArchives/router";

const recordTitle = "images-1-";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const owner = await getUserByOpenId(ENV.ownerOpenId) ?? await getUserByEmail("adamamin2027@gmail.com");
  assert(owner, "Adam’s authorized account is not available in the runtime database.");
  const db = await getDb();
  assert(db, "The runtime database is unavailable.");
  const matches = await db
    .select({ projectId: vraRecords.projectId, recordId: vraRecords.id })
    .from(vraRecords)
    .innerJoin(projects, eq(vraRecords.projectId, projects.id))
    .where(and(
      eq(projects.userId, owner.id),
      eq(vraRecords.recordType, "image"),
      eq(vraRecords.title, recordTitle),
    ))
    .orderBy(desc(vraRecords.updatedAt))
    .limit(1);
  const match = matches[0];
  assert(match, `No owner-owned Image record titled ${JSON.stringify(recordTitle)} was found.`);
  const before = await getVraRecord(match.projectId, match.recordId);
  assert(before, "The matched record could not be read.");
  const reviewedBefore = JSON.stringify(before.reviewedJson);

  const caller = visualArchivesRouter.createCaller({ req: {} as any, res: {} as any, user: owner });
  const result = await caller.generateSuggestions({ projectId: match.projectId, recordId: match.recordId });
  const after = await getVraRecord(match.projectId, match.recordId);
  assert(after, "The record could not be read after suggestion generation.");
  assert(JSON.stringify(after.reviewedJson) === reviewedBefore, "Suggestion generation modified human-reviewed metadata.");

  const candidates = Array.isArray((result.aiSuggestedJson as Record<string, unknown>).identificationCandidates)
    ? (result.aiSuggestedJson as Record<string, unknown>).identificationCandidates as Array<Record<string, unknown>>
    : [];
  console.log(JSON.stringify({
    projectId: match.projectId,
    recordId: match.recordId,
    suggestionStatus: result.status,
    suggestedTitle: (result.aiSuggestedJson as Record<string, unknown>).title,
    candidateCount: candidates.length,
    candidates: candidates.map(candidate => ({
      name: candidate.name,
      classification: candidate.classification,
      location: candidate.location,
      confidence: candidate.confidence,
    })),
    reviewedMetadataUnchanged: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
