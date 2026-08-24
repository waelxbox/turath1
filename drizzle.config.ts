import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for Drizzle commands. Copy .env.example to .env and set a PostgreSQL connection string."
  );
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  // The repository's original root and drizzle/migrations histories are retained
  // as forensic artifacts. They contain incompatible MySQL metadata and corrupted
  // SQL and must never be used for a fresh deployment.
  out: "./drizzle/staging-migrations",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: databaseUrl,
  },
});
