import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

const { chromium } = await import("playwright");
const base = "http://127.0.0.1:5184";
const output = "/tmp/turath-visual-review-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(existsSync("/usr/bin/chromium") ? { executablePath: "/usr/bin/chromium" } : { channel: "chrome" }),
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));

const now = new Date().toISOString();
const records = [
  { id: "123e4567-e89b-42d3-a456-426614174011", title: "Cairo streetcar beside a cinema", recordType: "image", status: "approved", localIdentifier: "CAI-1940-01", revision: 3, assetId: null, createdAt: now, updatedAt: now, asset: null, matchReasons: ["title: cairo", "dates: 1940", "locations: Cairo"] },
  { id: "123e4567-e89b-42d3-a456-426614174012", title: "Mosque courtyard and balcony", recordType: "image", status: "approved", localIdentifier: "CAI-1947-02", revision: 2, assetId: null, createdAt: now, updatedAt: now, asset: null, matchReasons: ["locations: Cairo", "subjects: balcony"] },
];

await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) return route.abort();
  if (!url.pathname.includes("/api/trpc/")) return route.fallback();
  const paths = decodeURIComponent(url.pathname.split("/api/trpc/")[1]).split(",");
  const raw = url.searchParams.get("input");
  const inputs = raw ? JSON.parse(raw) : {};
  const body = [];
  for (const [index, path] of paths.entries()) {
    const input = inputs[index]?.json ?? inputs.json ?? {};
    let data;
    if (path === "auth.me") data = { id: 1, name: "Adam", email: "adamamin2027@gmail.com", role: "admin" };
    else if (path === "projects.get") data = { id: 12, name: "Historic Cairo Image Archive", description: "Synthetic private-preview collection", archiveMode: "visual_vra", _memberRole: "owner", status: "active" };
    else if (path === "visualArchives.availability") data = { enabled: true, memoryEnabled: false };
    else if (path === "visualArchives.searchReviewedCatalog") data = {
      items: records,
      total: records.length,
      nextOffset: null,
      facets: {
        workType: [{ value: "photograph", count: 2 }],
        locations: [{ value: "Cairo", count: 2 }],
        subjects: [{ value: "balcony", count: 1 }],
        materials: [], techniques: [], stylePeriod: [],
      },
      applied: input,
    };
    else throw new Error(`Unexpected API path: ${path}`);
    body.push({ result: { data: { json: data } } });
  }
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
});

try {
  await page.goto(`${base}/projects/12/search`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Explore approved catalog evidence" }).waitFor();
  await page.getByText("Semantic visual memory is not enabled").waitFor();
  await page.getByText("2 approved records found").waitFor();
  await page.screenshot({ path: `${output}/search-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/search-mobile.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Search overflows on mobile");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/projects/12/ask`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Ask this Visual Archive" }).waitFor();
  await page.getByText("Approved evidence only").waitFor();
  await page.screenshot({ path: `${output}/chat-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/chat-mobile.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Chat overflows on mobile");
  assert.deepEqual(errors, []);
  console.log(`PASS: Visual Archives search/chat desktop and mobile. Screenshots: ${output}`);
} finally {
  await browser.close();
}
