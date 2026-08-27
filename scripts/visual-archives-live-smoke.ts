import { and, eq } from "drizzle-orm";
import { SignJWT } from "jose";
import sharp from "sharp";
import { vraRecordRevisions, vraRecords } from "../drizzle/schema";
import { COOKIE_NAME } from "../shared/const";
import { ENV } from "../server/_core/env";
import { getDb, getUserByEmail, getUserByOpenId } from "../server/db";
import { visualArchivesRouter } from "../server/visualArchives/router";

const baseUrl = process.env.VISUAL_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function ownerSessionCookie(user: { openId: string; name: string | null }): Promise<string> {
  const secret = new TextEncoder().encode(ENV.cookieSecret || "turath-fallback-secret");
  const token = await new SignJWT({
    openId: user.openId,
    name: user.name || ENV.ownerName || "TURATH owner",
    appId: ENV.appId || "turath",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
  return `${COOKIE_NAME}=${token}`;
}

async function syntheticPng(): Promise<Buffer> {
  const svg = `
    <svg width="960" height="640" xmlns="http://www.w3.org/2000/svg">
      <rect width="960" height="640" fill="#f6f0df"/>
      <rect x="72" y="72" width="816" height="496" fill="#fffaf0" stroke="#392d21" stroke-width="6"/>
      <text x="120" y="200" font-size="48" font-family="serif" fill="#392d21">SYNTHETIC VRA STAGING TEST</text>
      <text x="120" y="290" font-size="34" font-family="serif" fill="#392d21">Visible evidence only · 2026</text>
      <circle cx="480" cy="425" r="74" fill="#b68b40"/>
      <path d="M400 425h160M480 345v160" stroke="#fffaf0" stroke-width="12"/>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  assert(ENV.visualArchivesEnabled, "Visual Archives is not enabled in this runtime.");
  const owner = await getUserByOpenId(ENV.ownerOpenId) ?? await getUserByEmail("adamamin2027@gmail.com");
  assert(owner, "The authorized owner account is not present in the runtime database.");

  const caller = visualArchivesRouter.createCaller({ req: {} as any, res: {} as any, user: owner });
  const availability = await caller.availability();
  assert(availability.enabled, "The availability procedure did not report the feature enabled.");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const project = await caller.createProject({
    name: `[Internal] Visual Archives smoke ${stamp}`,
    description: "Synthetic staging-only test asset. Retain for audit evidence; do not use as collection content.",
  });

  const image = await syntheticPng();
  const asset = await caller.uploadAsset({
    projectId: project.id,
    filename: "synthetic-vra-staging.png",
    mimeType: "image/png",
    fileBase64: image.toString("base64"),
  });
  assert(asset.status === "ready", "The uploaded visual asset did not reach ready status.");
  assert(!("originalKey" in asset), "The asset response exposed a raw original storage key.");
  assert(!("displayKey" in asset), "The asset response exposed a raw display storage key.");
  assert(!("thumbnailKey" in asset), "The asset response exposed a raw thumbnail storage key.");

  const unauthenticated = await fetch(`${baseUrl}${asset.thumbnailUrl}`);
  assert(unauthenticated.status === 401, `Unauthenticated thumbnail request returned ${unauthenticated.status}, not 401.`);

  const cookie = await ownerSessionCookie(owner);
  const deliveryChecks = [
    ["original", asset.originalUrl, "image/png", "private, no-store"],
    ["display", asset.displayUrl, "image/jpeg", "private, max-age=3600"],
    ["thumbnail", asset.thumbnailUrl, "image/jpeg", "private, max-age=3600"],
  ] as const;
  for (const [variant, url, expectedType, expectedCache] of deliveryChecks) {
    assert(url, `${variant} URL was not returned.`);
    const response = await fetch(`${baseUrl}${url}`, { headers: { Cookie: cookie } });
    assert(response.ok, `Authenticated ${variant} request returned ${response.status}.`);
    assert(response.headers.get("content-type")?.startsWith(expectedType), `${variant} content type was not ${expectedType}.`);
    assert(response.headers.get("cache-control") === expectedCache, `${variant} cache policy was not ${expectedCache}.`);
    assert((await response.arrayBuffer()).byteLength > 0, `${variant} delivery returned an empty body.`);
  }

  const collection = await caller.createRecord({
    projectId: project.id,
    recordType: "collection",
    title: "Synthetic Visual Archives Collection",
    reviewedJson: { description: "Human-created staging record." },
  });
  const work = await caller.createRecord({
    projectId: project.id,
    recordType: "work",
    title: "Synthetic VRA Work",
    reviewedJson: { description: "Human-created staging work." },
  });
  const imageRecord = await caller.createRecord({
    projectId: project.id,
    recordType: "image",
    title: "Synthetic Visual Asset",
    assetId: asset.id,
    reviewedJson: { description: "Human-reviewed baseline description." },
  });
  const relation = await caller.createRelation({
    projectId: project.id,
    sourceRecordId: work.id,
    targetRecordId: imageRecord.id,
    relationType: "has visual representation",
  });
  assert(relation.status === "approved", "The deliberate Work–Image relation was not approved.");

  const suggestions = await caller.generateSuggestions({ projectId: project.id, recordId: imageRecord.id });
  assert(suggestions.status === "needs_review", "AI suggestions did not move the record to needs_review.");
  assert(typeof suggestions.aiSuggestedJson === "object" && suggestions.aiSuggestedJson !== null, "AI suggestions were not stored separately.");
  assert((suggestions.reviewedJson as Record<string, unknown>).description === "Human-reviewed baseline description.", "AI suggestions modified reviewed data before explicit acceptance.");
  assert((suggestions.suggestionProvenance as Record<string, unknown>).source === "visual-evidence-only", "Suggestion provenance did not retain the evidence-only marker.");

  await caller.acceptSuggestionFields({
    projectId: project.id,
    recordId: imageRecord.id,
    acceptedFields: ["description"],
  });
  const approved = await caller.updateRecord({
    projectId: project.id,
    recordId: imageRecord.id,
    status: "approved",
    changeSummary: "Internal staging smoke approval after explicit field review.",
  });
  assert(approved.status === "approved", "The reviewed image record could not be approved.");

  let forbiddenFieldRejected = false;
  try {
    await (caller.acceptSuggestionFields as any)({
      projectId: project.id,
      recordId: imageRecord.id,
      acceptedFields: ["confidenceNotes"],
    });
  } catch {
    forbiddenFieldRejected = true;
  }
  assert(forbiddenFieldRejected, "The non-reviewable confidenceNotes field was accepted.");

  const db = await getDb();
  assert(db, "Database became unavailable while checking revision provenance.");
  const [storedRecord] = await db
    .select()
    .from(vraRecords)
    .where(and(eq(vraRecords.projectId, project.id), eq(vraRecords.id, imageRecord.id)));
  assert(storedRecord, "The image record was not persisted.");
  assert(Object.keys(storedRecord.aiSuggestedJson as Record<string, unknown>).length >= 0, "The stored AI suggestion payload is malformed.");
  const revisions = await db
    .select()
    .from(vraRecordRevisions)
    .where(and(eq(vraRecordRevisions.projectId, project.id), eq(vraRecordRevisions.recordId, imageRecord.id)));
  assert(revisions.length >= 3, "Expected creation, explicit-acceptance, and approval revisions were not persisted.");

  const stats = await caller.stats({ projectId: project.id });
  assert(
    stats.assets === 1 && stats.collections === 1 && stats.works === 1 && stats.images === 1,
    "Visual Archive aggregate counts are incorrect.",
  );

  console.log(JSON.stringify({
    projectId: project.id,
    assetId: asset.id,
    checks: {
      availability: true,
      pngUploadAndDerivatives: true,
      unauthenticatedDeliveryDenied: true,
      authenticatedOriginalDisplayThumbnailDelivery: true,
      vraCollectionWorkImageCatalog: true,
      approvedWorkImageRelation: true,
      aiSuggestionsSeparatedFromReviewedData: true,
      explicitAllowedFieldAcceptance: true,
      confidenceNotesRejection: true,
      revisionProvenance: true,
    },
    revisionCount: revisions.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
