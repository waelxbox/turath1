// Production-bundle UI checks with synthetic data only. No external requests/payments.
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
const { chromium } = await import(
  process.env.BILLING_QA_PLAYWRIGHT || "playwright"
);
const root = resolve("dist/public");
const server = http.createServer(async (req, res) => {
  try {
    const name = new URL(req.url, "http://localhost").pathname;
    const file = name.startsWith("/assets/")
      ? resolve(root, `.${name}`)
      : resolve(root, "index.html");
    if (!file.startsWith(`${root}/`)) {
      res.writeHead(403);
      return res.end();
    }
    const mime =
      {
        ".js": "application/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".svg": "image/svg+xml",
      }[extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve, reject) => {
  server.listen(0, "127.0.0.1", resolve);
  server.once("error", reject);
});
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
let mode = "free",
  ready = true,
  fail = false;
const events = [],
  errors = [];
page.on("pageerror", error => errors.push(error.message));
const catalog = {
  free: {
    name: "Free",
    priceMonthly: 0,
    documentLimit: 20,
    features: ["20 documents"],
  },
  pro: {
    name: "Pro",
    priceMonthly: 2000,
    documentLimit: 100,
    features: ["100 documents", "All AI models", "Search & Ask Archive"],
  },
  team: {
    name: "Team",
    priceMonthly: 5000,
    documentLimit: 300,
    features: ["300 documents", "All AI models", "Search & Ask Archive"],
  },
  enterprise: {
    name: "Archive",
    priceMonthly: 10000,
    documentLimit: 1000,
    features: ["1,000 documents", "All AI models", "Search & Ask Archive"],
  },
};
await page.route("**/*", async route => {
  const request = route.request(),
    url = new URL(request.url());
  if (url.origin !== base) {
    events.push(url.href);
    return route.abort();
  }
  // Unconfigured analytics/host-injected scripts are not part of the local fixture.
  if (
    request.resourceType() === "script" &&
    !url.pathname.startsWith("/assets/")
  )
    return route.abort();
  if (!url.pathname.startsWith("/api/trpc/")) return route.continue();
  const paths = url.pathname.split("/api/trpc/")[1].split(",");
  const raw =
    request.method() === "POST"
      ? JSON.parse(request.postData() || "{}")
      : JSON.parse(url.searchParams.get("input") || "{}");
  const results = paths.map((path, i) => {
    if (fail && path === "billing.getMyPlan")
      return {
        error: {
          json: {
            message: "Unavailable",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        },
      };
    let data;
    const plan = mode === "owner" ? "free" : mode;
    if (path === "billing.getPlans")
      data = { plans: catalog, paidUpgradesEnabled: ready };
    else if (path === "billing.getMyPlan")
      data = {
        plan,
        planName: mode === "owner" ? "Owner access" : catalog[plan].name,
        documentLimit: mode === "owner" ? null : catalog[plan].documentLimit,
        documentsUsed: 19,
        documentsRemaining:
          mode === "owner" ? null : catalog[plan].documentLimit - 19,
        isOwnerExempt: mode === "owner",
        paidUpgradesEnabled: ready,
        hasBillingAccount: mode === "pro",
        resetsAt: mode === "pro" ? "2026-10-07T12:00:00Z" : null,
        features: catalog[plan].features,
      };
    else if (
      path === "billing.createCheckout" ||
      path === "billing.createPortal"
    ) {
      events.push({ path, input: raw[i]?.json ?? raw.json });
      data = { url: `${base}/settings/billing?canceled=true` };
    } else if (path === "auth.me")
      data = { id: 1, email: "qa@example.test", name: "QA" };
    else throw new Error(`Unexpected API ${path}`);
    return { result: { data: { json: data } } };
  });
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(results),
  });
});
const open = async () => {
  await page.goto(`${base}/settings/billing`);
  await page
    .getByRole("heading", { name: "Plans & billing", exact: true })
    .waitFor();
};
try {
  await open();
  for (const name of ["Choose Pro", "Choose Team", "Choose Archive"])
    assert(await page.getByRole("button", { name, exact: true }).isEnabled());
  assert(
    await page.getByText("19 / 20 documents used · 1 remaining").isVisible()
  );
  const out = process.env.BILLING_QA_OUTPUT || "/tmp/turath-billing-qa";
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Choose Pro", exact: true }).click();
  await page
    .getByText("Checkout was canceled. Your current plan is unchanged.")
    .waitFor();
  assert.deepEqual(
    events.find(event => event.path === "billing.createCheckout").input,
    { planId: "pro" }
  );
  ready = false;
  mode = "pro";
  await open();
  assert(
    await page
      .getByRole("button", { name: "Manage subscription", exact: true })
      .isEnabled()
  );
  assert(
    await page
      .getByRole("button", { name: "Change plan in Stripe" })
      .first()
      .isDisabled()
  );
  await page
    .getByRole("button", { name: "Manage subscription", exact: true })
    .click();
  await page
    .getByText("Checkout was canceled. Your current plan is unchanged.")
    .waitFor();
  mode = "owner";
  await open();
  assert.equal(await page.getByRole("button", { name: /Choose / }).count(), 0);
  mode = "free";
  ready = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
  fail = true;
  await page.goto(`${base}/settings/billing`);
  await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page
    .getByRole("heading", { name: "Plans & billing", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile, three plan buttons, checkout payload, cancellation return, portal while checkout disabled, owner exemption, error/retry, no JS errors"
  );
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
