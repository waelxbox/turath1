import sharp from "sharp";
import { ENV } from "../server/_core/env";
import { getUserByEmail, getUserByOpenId } from "../server/db";
import { visualArchivesRouter } from "../server/visualArchives/router";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function syntheticPng(label: string, color: string): Promise<Buffer> {
  const svg = `<svg width="960" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="640" fill="${color}"/><rect x="64" y="64" width="832" height="512" fill="#fffaf0" stroke="#392d21" stroke-width="6"/><text x="110" y="290" font-size="58" font-family="serif" fill="#392d21">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  assert(ENV.visualArchivesEnabled, "Visual Archives is not enabled in this runtime.");
  const owner = await getUserByOpenId(ENV.ownerOpenId) ?? await getUserByEmail("adamamin2027@gmail.com");
  assert(owner, "The authorized owner account is not available.");
  const caller = visualArchivesRouter.createCaller({ req: {} as any, res: {} as any, user: owner });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const project = await caller.createProject({
    name: `[Internal] Visual Archives batch intake ${stamp}`,
    description: "Synthetic-only batch intake verification; do not use as collection content.",
  });
  const files = await Promise.all([
    syntheticPng("SYNTHETIC BATCH A", "#e4caa3"),
    syntheticPng("SYNTHETIC BATCH B", "#b6cde3"),
  ]);
  const uploads = await Promise.all(files.map((file, index) => caller.uploadAsset({
    projectId: project.id,
    filename: `synthetic-batch-${index + 1}.png`,
    mimeType: "image/png" as const,
    fileBase64: file.toString("base64"),
  })));
  assert(uploads.every(upload => upload.status === "ready"), "At least one batch asset did not reach ready status.");
  assert(uploads.every(upload => upload.autoCatalog.suggestionStatus === "generated"), "At least one batch asset did not receive an AI draft.");

  const imageRecords = await caller.listRecords({ projectId: project.id, recordType: "image" });
  assert(imageRecords.length === 2, "Batch intake did not create exactly one Image record per uploaded image.");
  assert(imageRecords.every(record => record.status === "needs_review"), "Batch records were not placed in the review queue.");
  assert(imageRecords.every(record => Object.keys(record.reviewedJson as Record<string, unknown>).length === 0), "Batch AI drafts modified reviewed metadata.");
  assert(imageRecords.every(record => Object.keys(record.aiSuggestedJson as Record<string, unknown>).length > 0), "A batch Image record has no separate AI draft.");

  const stats = await caller.stats({ projectId: project.id });
  assert(stats.assets === 2 && stats.images === 2 && stats.needsReview === 2, "Batch visual review statistics are incorrect.");
  console.log(JSON.stringify({ projectId: project.id, assetCount: uploads.length, imageRecordCount: imageRecords.length, needsReview: stats.needsReview, automaticAiDrafts: true }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
