import { ENV } from "../server/_core/env";
import { getUserByEmail, getUserByOpenId } from "../server/db";
import { visualArchivesRouter } from "../server/visualArchives/router";

const projectId = Number(process.env.VISUAL_SMOKE_PROJECT_ID);
if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("Set VISUAL_SMOKE_PROJECT_ID to a valid synthetic smoke project.");
const owner = await getUserByOpenId(ENV.ownerOpenId) ?? await getUserByEmail("adamamin2027@gmail.com");
if (!owner) throw new Error("Authorized owner account unavailable.");
const caller = visualArchivesRouter.createCaller({ req: {} as any, res: {} as any, user: owner });
const page = await caller.listAssetsPage({ projectId, status: "ready", limit: 100 });
console.log(page.items.map(asset => asset.id).join(","));
