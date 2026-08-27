import sharp from "sharp";
import { ENV } from "../server/_core/env";
import { getUserByEmail, getUserByOpenId } from "../server/db";
import { visualArchivesRouter } from "../server/visualArchives/router";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function syntheticPng(label: string, color: string): Promise<Buffer> {
  const svg = `<svg width="960" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="640" fill="${color}"/><rect x="64" y="64" width="832" height="512" fill="#fffaf0" stroke="#392d21" stroke-width="6"/><text x="110" y="290" font-size="50" font-family="serif" fill="#392d21">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  assert(ENV.visualArchivesEnabled, "Visual Archives is not enabled in this runtime.");
  const owner = await getUserByOpenId(ENV.ownerOpenId) ?? await getUserByEmail("adamamin2027@gmail.com");
  assert(owner, "The authorized owner account is not available.");
  const caller = visualArchivesRouter.createCaller({ req: {} as any, res: {} as any, user: owner });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const project = await caller.createProject({ name: `[Internal] Visual beta ${stamp}`, description: "Synthetic-only controlled-beta verification; do not use as collection content." });
  const files = await Promise.all([syntheticPng("SYNTHETIC COURTYARD A", "#e4caa3"), syntheticPng("SYNTHETIC COURTYARD B", "#b6cde3")]);
  const uploads = await Promise.all(files.map((file, index) => caller.uploadAsset({ projectId: project.id, filename: `synthetic-courtyard-${index + 1}.png`, mimeType: "image/png", fileBase64: file.toString("base64") })));
  assert(uploads.every(upload => upload.status === "ready" && upload.autoCatalog.suggestionStatus === "generated"), "Visual intake did not complete with isolated AI drafts.");
  const images = await caller.listRecords({ projectId: project.id, recordType: "image" });
  assert(images.length === 2, "Expected one automatically created Image record per synthetic upload.");
  for (const image of images) {
    await caller.updateRecord({ projectId: project.id, recordId: image.id, status: "approved", reviewedJson: { description: "Synthetic courtyard image for controlled testing", locations: ["Test Site"], subjects: ["courtyard"], workType: ["architecture"] }, changeSummary: "Synthetic smoke review approval" });
  }
  const work = await caller.createRecord({ projectId: project.id, recordType: "work", title: "Synthetic Courtyard Site", reviewedJson: { locations: ["Test Site"], workType: ["architecture"] } });
  await caller.updateRecord({ projectId: project.id, recordId: work.id, status: "approved", changeSummary: "Synthetic smoke work approval" });
  const linked = await caller.linkImagesToWork({ projectId: project.id, workRecordId: work.id, imageRecordIds: images.map(image => image.id) });
  assert(linked.linked === 2, "Selected Images were not linked to the human-created Work.");
  const grouping = await caller.suggestImageGrouping({ projectId: project.id, imageRecordIds: images.map(image => image.id) });
  assert(grouping.reviewedByHuman === false && grouping.evaluatedRecordIds.length === 2, "AI grouping output was not retained as review-only.");
  const search = await caller.searchReviewedCatalog({ projectId: project.id, query: "Test Site", facets: { subjects: ["courtyard"] }, limit: 48 });
  assert(search.total === 2 && search.items.every(item => !("aiSuggestedJson" in item)), "Reviewed search leaked AI drafts or returned an unexpected set.");
  const answer = await caller.askArchive({ projectId: project.id, question: "Which approved Images depict the test-site courtyard?" });
  assert(answer.sources.length > 0 && answer.answer.includes("[Record"), "Evidence-linked Visual Archives Q&A did not return cited sources.");
  const exported = await caller.exportCatalog({ projectId: project.id });
  assert(exported.records.length === 3 && !exported.records.some(record => "aiSuggestedJson" in record), "Reviewed catalog export did not preserve the approved-only boundary.");
  console.log(JSON.stringify({ projectId: project.id, assets: uploads.length, reviewedImages: images.length, grouping: grouping.relationship, searchResults: search.total, citedQaSources: answer.sources.length, exportRecords: exported.records.length }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
