import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://3000-iq3zp1mnn30f1iaqevqxp-27d78d34.us2.manus.computer";
const projectPath = "/projects/144/catalog";
const outputDir = "/home/ubuntu/visual-archives-responsive-qa";
const token = (await readFile("/tmp/visual-productization-final-session.txt", "utf8")).trim();

if (!token) {
  throw new Error("Missing temporary Visual Archives QA session token.");
}

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--disable-dev-shm-usage"],
});
const results = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    await context.addCookies([
      {
        name: "app_session_id",
        value: token,
        url: baseUrl,
        path: "/",
        sameSite: "Lax",
        secure: true,
      },
    ]);

    const page = await context.newPage();
    const response = await page.goto(`${baseUrl}${projectPath}`, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForSelector("text=VRA catalog", { timeout: 15_000 });
    await page.screenshot({
      path: path.join(outputDir, `catalog-${viewport.name}.png`),
      fullPage: true,
    });
    results.push({
      viewport: viewport.name,
      status: response?.status() ?? null,
      finalUrl: page.url(),
      title: await page.title(),
    });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ outputDir, results }, null, 2));
