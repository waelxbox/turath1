import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const configPath = path.join(projectRoot, "drizzle.config.ts");
const configSource = await readFile(configPath, "utf8");
const outMatch = configSource.match(/\bout\s*:\s*["']([^"']+)["']/);

if (!outMatch) {
  throw new Error(
    "drizzle.config.ts must declare a literal migration output directory"
  );
}

const migrationDirectory = path.resolve(projectRoot, outMatch[1]);
const journalPath = path.join(migrationDirectory, "meta", "_journal.json");
const journal = JSON.parse(await readFile(journalPath, "utf8"));
const failures = [];

if (journal.dialect !== "postgresql") {
  failures.push(
    `migration journal dialect is ${journal.dialect}, expected postgresql`
  );
}

const files = await readdir(migrationDirectory, { withFileTypes: true });
const sqlFiles = files
  .filter(entry => entry.isFile() && entry.name.endsWith(".sql"))
  .map(entry => entry.name)
  .sort();

if (sqlFiles.length === 0) {
  failures.push("no SQL migration files were found");
}

for (const fileName of sqlFiles) {
  const content = await readFile(path.join(migrationDirectory, fileName));
  if (content.includes(0)) failures.push(`${fileName} contains NUL bytes`);
  if (content.toString("utf8").trim().length === 0) {
    failures.push(`${fileName} is empty`);
  }
}

for (const entry of journal.entries ?? []) {
  const expectedFile = `${entry.tag}.sql`;
  if (!sqlFiles.includes(expectedFile)) {
    failures.push(`journal entry ${entry.tag} has no matching SQL file`);
  }
}

if (failures.length > 0) {
  console.error("Migration verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${sqlFiles.length} PostgreSQL migration file(s) in ${path.relative(projectRoot, migrationDirectory)}`
  );
}
