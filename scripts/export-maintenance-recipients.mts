import postgres from "postgres";
import { writeFile } from "node:fs/promises";

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DATABASE_URL is not available.");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });

const rows = await sql`
  SELECT
    u.id,
    u.name,
    u.email,
    u.role,
    u."createdAt" AS created_at,
    u."lastSignedIn" AS last_signed_in,
    COUNT(DISTINCT p.id) AS project_count,
    COUNT(DISTINCT d.id) AS document_count
  FROM users u
  LEFT JOIN projects p ON p."userId" = u.id
  LEFT JOIN documents d ON d."projectId" = p.id
  GROUP BY u.id, u.name, u.email, u.role, u."createdAt", u."lastSignedIn"
  ORDER BY u."lastSignedIn" DESC
`;

const escape = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

const header = [
  "id",
  "name",
  "email",
  "role",
  "created_at",
  "last_signed_in",
  "project_count",
  "document_count",
];
const content = [
  header.join(","),
  ...rows.map((row) => header.map((field) => escape(row[field as keyof typeof row])).join(",")),
].join("\n") + "\n";

await writeFile("/home/ubuntu/turath-maintenance-recipients.csv", content, "utf8");
console.log(`Exported ${rows.length} accounts to /home/ubuntu/turath-maintenance-recipients.csv`);

await sql.end({ timeout: 5 });
