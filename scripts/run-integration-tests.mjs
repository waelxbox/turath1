import { spawnSync } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.TURATH_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TURATH_TEST_DATABASE_URL is required; integration tests never use the staging database URL implicitly"
  );
}

const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\//, "");
if (
  !/(^|[_-])test($|[_-])/.test(databaseName) &&
  process.env.TURATH_ALLOW_NON_TEST_DATABASE !== "true"
) {
  throw new Error(
    `Refusing to run integration tests against database '${databaseName}'. Use a database name containing 'test'.`
  );
}

const vitestEntry = path.resolve("node_modules", "vitest", "vitest.mjs");
const result = spawnSync(
  process.execPath,
  [vitestEntry, "run", "server/members.test.ts"],
  {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      GOOGLE_CLIENT_ID:
        process.env.GOOGLE_CLIENT_ID ??
        "640280511703-rt61ei88l0vavp8g7t6a6ltro75b7kjt.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET:
        process.env.GOOGLE_CLIENT_SECRET ?? "integration-test-only",
    },
    stdio: "inherit",
  }
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
