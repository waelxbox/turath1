import postgres from "postgres";

const useRuntimeConnection = process.argv.includes("--runtime");
const connectionString = useRuntimeConnection
  ? process.env.SUPABASE_DATABASE_URL
  : process.env.SUPABASE_DIRECT_URL ?? process.env.SUPABASE_DATABASE_URL;

if (!connectionString) {
  throw new Error("A Supabase PostgreSQL connection string is not configured.");
}

const sql = postgres(connectionString, { max: 1 });
const tableNames = [
  "visual_project_modes",
  "visual_assets",
  "vra_records",
  "vra_record_relations",
  "vra_record_revisions",
];

try {
  const [identity, tables, constraints, indexes, policies] = await Promise.all([
    sql`SELECT current_user AS current_user,
               session_user AS session_user,
               current_setting('row_security') AS row_security_setting,
               r.rolsuper AS is_superuser,
               r.rolbypassrls AS bypasses_rls
          FROM pg_roles AS r
         WHERE r.rolname = current_user`,
    sql`SELECT c.relname AS table_name,
              c.relrowsecurity AS rls_enabled,
              c.relforcerowsecurity AS rls_forced
         FROM pg_class AS c
         JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname = ANY(${tableNames}::text[])
        ORDER BY c.relname`,
    sql`SELECT tc.table_name,
              tc.constraint_name,
              tc.constraint_type,
              string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns,
              ccu.table_name AS referenced_table
         FROM information_schema.table_constraints AS tc
         LEFT JOIN information_schema.key_column_usage AS kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         LEFT JOIN information_schema.constraint_column_usage AS ccu
           ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = ANY(${tableNames}::text[])
        GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type, ccu.table_name
        ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name`,
    sql`SELECT tablename AS table_name, indexname AS index_name, indexdef AS index_definition
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = ANY(${tableNames}::text[])
        ORDER BY tablename, indexname`,
    sql`SELECT tablename AS table_name,
              policyname AS policy_name,
              permissive,
              roles,
              cmd,
              qual,
              with_check
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY(${tableNames}::text[])
        ORDER BY tablename, policyname`,
  ]);

  const report = {
    connection: {
      kind: useRuntimeConnection ? "runtime" : "direct",
      identity: identity[0],
    },
    tables,
    constraints,
    indexes: indexes.map(({ index_definition, ...index }) => ({
      ...index,
      definition_kind: index_definition.includes("UNIQUE") ? "unique" : "standard",
    })),
    policies: policies.map(({ qual, with_check, ...policy }) => ({
      ...policy,
      has_using_expression: Boolean(qual),
      has_check_expression: Boolean(with_check),
    })),
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
