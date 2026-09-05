// Local-only UI smoke test. All API data is synthetic; never connects to a real
// TURATH database. Start Vite on 127.0.0.1:5183 before running this script.
const { chromium } = await import(
  process.env.ADMIN_QA_PLAYWRIGHT || "playwright"
);
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.ADMIN_QA_BASE || "http://127.0.0.1:5183";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "QA must target a local server");
const output = process.env.ADMIN_QA_OUTPUT || "/tmp/turath-admin-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);
await page.route("**/*", route => {
  const url = new URL(route.request().url());
  return url.origin === base ? route.fallback() : route.abort();
});
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let identity = "owner",
  failUsers = false,
  delayUsers = false;
let privateRequests = 0;
const timestamp = new Date().toISOString();
const metrics = {
  documents: 48,
  assets: 16,
  transcriptions: 42,
  bytes: 1_200_000_000,
  reviewed: 33,
  reviewQueue: 12,
  errors: 3,
  processing: 0,
  unknownSize: 2,
  assetErrors: 1,
  records: 24,
  approvedRecords: 18,
  recordReviewQueue: 4,
  failedJobs: 2,
  queuedJobs: 0,
  runningJobs: 1,
  conversations: 8,
};
const users = Array.from({ length: 52 }, (_, i) => ({
  id: i + 1,
  name: `Researcher ${i + 1}`,
  email: `person${i + 1}@example.test`,
  plan: "free",
  createdAt: timestamp,
  lastSignedIn: timestamp,
  documentQuotaUsed: 20,
  projects: 2,
  sharedProjects: 1,
  ...metrics,
}));
await page.route("**/api/trpc/**", async route => {
  const url = new URL(route.request().url());
  const paths = decodeURIComponent(url.pathname.split("/api/trpc/")[1]).split(
    ","
  );
  const inputs = JSON.parse(url.searchParams.get("input") || "{}");
  const body = [];
  for (const [index, path] of paths.entries()) {
    const input = inputs[index]?.json || {};
    let data;
    if (path === "auth.me")
      data =
        identity === "anonymous"
          ? null
          : {
              id: 99,
              name: "Adam",
              email:
                identity === "owner"
                  ? "adamamin2027@gmail.com"
                  : "other@example.test",
              role: "admin",
            };
    else if (path === "admin.access") data = { allowed: identity === "owner" };
    else {
      privateRequests++;
      assert.equal(identity, "owner", "Private data requested for a non-owner");
      if (path === "admin.overview")
        data = {
          totals: {
            ...metrics,
            projects: 8,
            visualProjects: 2,
            activeProjects: 6,
            users: 52,
            newUsers30: 23,
            signedIn30: 29,
            signedIn7: 12,
            cappedUsers: 5,
          },
          generatedAt: timestamp,
          trend: Array.from({ length: 30 }, (_, i) => ({
            day: `2026-08-${String(i + 1).padStart(2, "0")}`,
            signups: i % 5,
            projects: i % 3,
            documents: i % 7,
            images: i % 4,
          })),
        };
      else if (path === "admin.users") {
        if (delayUsers) await new Promise(resolve => setTimeout(resolve, 800));
        if (failUsers) {
          body.push({
            error: {
              json: {
                message: "Temporary unavailable",
                code: -32603,
                data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path },
              },
            },
          });
          continue;
        }
        const filtered = users.filter(
          u => !input.search || u.email.includes(input.search)
        );
        data = {
          total: filtered.length,
          rows: filtered.slice(
            input.page * input.limit,
            (input.page + 1) * input.limit
          ),
        };
      } else if (path === "admin.projects")
        data = {
          total: 1,
          rows: [
            {
              ...metrics,
              id: 137,
              userId: input.userId || 1,
              name: "Historic Cairo photographic collection",
              status: "active",
              mode: "visual_vra",
              createdAt: timestamp,
              updatedAt: timestamp,
              members: 2,
              ownerName: "Researcher 1",
              ownerEmail: "person1@example.test",
              userRole: input.userId ? "owner" : null,
            },
          ],
        };
      else if (path === "admin.members")
        data = {
          total: 2,
          rows: [
            {
              id: 1,
              name: "Researcher 1",
              email: "person1@example.test",
              role: "owner",
            },
            {
              id: 2,
              name: "Researcher 2",
              email: "person2@example.test",
              role: "editor",
            },
          ],
        };
      else throw new Error(`Unexpected API: ${path}`);
    }
    body.push({ result: { data: { json: data } } });
  }
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
});
try {
  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "TURATH at a glance" }).waitFor();
  await page
    .getByRole("button", {
      name: "View projects for person1@example.test",
      exact: true,
    })
    .waitFor();
  await page
    .getByText("Cost assumptions · USD · click to configure", { exact: true })
    .click();
  await page.getByLabel("USD per saved transcription").fill("0.02");
  await page.getByLabel("USD per visual asset intake").fill("0.03");
  await page.getByLabel("USD per GB per month").fill("0.1");
  assert.ok((await page.getByText("$1.32", { exact: true }).count()) > 0);
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", {
      name: "View projects for person26@example.test",
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page
    .getByRole("button", {
      name: "View projects for person1@example.test",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "Projects for Researcher 1" })
    .waitFor();
  await page.getByRole("button", { name: "View members", exact: true }).click();
  await page.getByText("person2@example.test", { exact: true }).waitFor();
  await page.screenshot({
    path: `${output}/project-members.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    "Mobile page overflows horizontally"
  );
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("textbox", { name: "Search users" }).fill("no-results");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("No users match these filters.").waitFor();
  failUsers = true;
  await page.getByRole("button", { name: "Refresh users" }).click();
  await page.getByRole("alert").filter({ hasText: "Couldn’t load" }).waitFor();
  failUsers = false;
  delayUsers = true;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("No users match these filters.").waitFor();
  identity = "other";
  const before = privateRequests;
  await page.reload();
  await page.getByRole("heading", { name: "Owner access required" }).waitFor();
  assert.equal(privateRequests, before);
  identity = "anonymous";
  await page.reload();
  await page.getByRole("heading", { name: "Sign in to continue" }).waitFor();
  assert.equal(privateRequests, before);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: owner UI, costs, pagination, members, mobile, empty/error/retry, denied and anonymous states. Screenshots: ${output}`
  );
} finally {
  await browser.close();
}
