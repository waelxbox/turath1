import { SignJWT } from "jose";
import { COOKIE_NAME } from "../shared/const";
import { ENV } from "../server/_core/env";
import { getUserByEmail, getUserByOpenId } from "../server/db";
import { visualArchivesRouter } from "../server/visualArchives/router";

const projectId = Number(process.env.VISUAL_SMOKE_PROJECT_ID);
const assetId = process.env.VISUAL_SMOKE_ASSET_ID;
const baseUrl = process.env.VISUAL_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(Number.isInteger(projectId) && projectId > 0, "VISUAL_SMOKE_PROJECT_ID is required.");
  assert(assetId, "VISUAL_SMOKE_ASSET_ID is required.");
  const owner = await getUserByOpenId(ENV.ownerOpenId) ?? await getUserByEmail("adamamin2027@gmail.com");
  assert(owner, "The authorized owner account is not present in the runtime database.");
  const caller = visualArchivesRouter.createCaller({ req: {} as any, res: {} as any, user: owner });
  const sibling = await caller.createProject({
    name: `[Internal] Visual Archives isolation smoke ${new Date().toISOString().replace(/[:.]/g, "-")}`,
    description: "Empty internal project used only to verify project-scoped visual asset isolation.",
  });

  let foreignAssetRejected = false;
  try {
    await caller.createRecord({
      projectId: sibling.id,
      recordType: "image",
      title: "Must not attach a sibling project asset",
      assetId,
      reviewedJson: {},
    });
  } catch (error: any) {
    foreignAssetRejected = error?.code === "NOT_FOUND";
  }
  assert(foreignAssetRejected, "A visual asset from another project was accepted into a sibling project record.");

  const secret = new TextEncoder().encode(ENV.cookieSecret || "turath-fallback-secret");
  const token = await new SignJWT({ openId: owner.openId, name: owner.name || "TURATH owner", appId: ENV.appId || "turath" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
  const response = await fetch(`${baseUrl}/api/storage/projects/${sibling.id}/visual-assets/${assetId}/thumbnail`, {
    headers: { Cookie: `${COOKIE_NAME}=${token}` },
  });
  assert(response.status === 404, `Cross-project protected asset request returned ${response.status}, not 404.`);

  console.log(JSON.stringify({
    sourceProjectId: projectId,
    siblingProjectId: sibling.id,
    checks: {
      crossProjectAssetAttachmentDenied: true,
      crossProjectProtectedAssetDeliveryDenied: true,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
