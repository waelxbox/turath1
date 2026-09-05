import { sql, type SQL } from "drizzle-orm";
import { FREE_DOCUMENT_LIMIT } from "../billing/products";

// Aggregate each child table before joining, so multiple documents, members and
// jobs never multiply each other's counts. Detail requests scope first.
export function projectMetrics(scope: SQL = sql`true`): SQL {
  return sql`
    scoped_projects as (select p.* from projects p where ${scope}),
    doc as (
      select d."projectId", count(*)::float8 documents,
        count(*) filter (where d.status = 'reviewed')::float8 reviewed,
        count(*) filter (where d.status in ('needs_review', 'flagged'))::float8 "reviewQueue",
        count(*) filter (where d.status = 'error')::float8 errors,
        count(*) filter (where d.status = 'processing')::float8 processing,
        coalesce(sum(d."fileSizeBytes"), 0)::float8 bytes,
        count(*) filter (where d."fileSizeBytes" is null)::float8 "unknownSize"
      from documents d join scoped_projects p on p.id = d."projectId" group by d."projectId"
    ),
    trans as (select t."projectId", count(*)::float8 transcriptions from transcriptions t
      join scoped_projects p on p.id = t."projectId" group by t."projectId"),
    asset as (select a."projectId", count(*)::float8 assets,
      count(*) filter (where a.status = 'failed')::float8 "assetErrors",
      coalesce(sum(a."byteSize"), 0)::float8 bytes
      from visual_assets a join scoped_projects p on p.id = a."projectId" group by a."projectId"),
    rec as (select r."projectId", count(*)::float8 records,
      count(*) filter (where r.status = 'approved')::float8 "approvedRecords",
      count(*) filter (where r.status = 'needs_review')::float8 "recordReviewQueue"
      from vra_records r join scoped_projects p on p.id = r."projectId" group by r."projectId"),
    job as (select j."projectId", count(*) filter (where j.status = 'failed')::float8 "failedJobs",
      count(*) filter (where j.status = 'queued')::float8 "queuedJobs",
      count(*) filter (where j.status = 'running')::float8 "runningJobs"
      from jobs j join scoped_projects p on p.id = j."projectId" group by j."projectId"),
    people as (select p.id, count(distinct m."userId") filter (where m."userId" <> p."userId")::float8 + 1 members
      from scoped_projects p left join project_members m on m."projectId" = p.id group by p.id),
    chat as (select c."projectId", count(*)::float8 conversations from research_conversations c
      join scoped_projects p on p.id = c."projectId" group by c."projectId"),
    metrics as (select p.id, p."userId", p.name, p.status, p."createdAt", p."updatedAt",
      coalesce(vm."archiveMode"::text, 'document_transcription') mode,
      coalesce(d.documents, 0) documents, coalesce(d.reviewed, 0) reviewed,
      coalesce(d."reviewQueue", 0) "reviewQueue", coalesce(d.errors, 0) errors,
      coalesce(d.processing, 0) processing, coalesce(d."unknownSize", 0) "unknownSize",
      coalesce(d.bytes, 0) + coalesce(a.bytes, 0) bytes,
      coalesce(t.transcriptions, 0) transcriptions, coalesce(a.assets, 0) assets,
      coalesce(a."assetErrors", 0) "assetErrors", coalesce(r.records, 0) records,
      coalesce(r."approvedRecords", 0) "approvedRecords", coalesce(r."recordReviewQueue", 0) "recordReviewQueue",
      coalesce(j."failedJobs", 0) "failedJobs", coalesce(j."queuedJobs", 0) "queuedJobs",
      coalesce(j."runningJobs", 0) "runningJobs", people.members,
      coalesce(c.conversations, 0) conversations
      from scoped_projects p left join visual_project_modes vm on vm."projectId" = p.id
      left join doc d on d."projectId" = p.id left join trans t on t."projectId" = p.id
      left join asset a on a."projectId" = p.id left join rec r on r."projectId" = p.id
      left join job j on j."projectId" = p.id left join people on people.id = p.id
      left join chat c on c."projectId" = p.id
    )`;
}

export const metricKeys = [
  "documents",
  "reviewed",
  "reviewQueue",
  "errors",
  "processing",
  "unknownSize",
  "bytes",
  "transcriptions",
  "assets",
  "assetErrors",
  "records",
  "approvedRecords",
  "recordReviewQueue",
  "failedJobs",
  "queuedJobs",
  "runningJobs",
  "conversations",
] as const;
export type Metrics = Record<(typeof metricKeys)[number], number>;
const sums = sql.join(
  metricKeys.map(
    key =>
      sql`coalesce(sum(${sql.identifier(key)}), 0)::float8 as ${sql.identifier(key)}`
  ),
  sql`, `
);

export const overviewQuery = sql`with ${projectMetrics()}
  select ${sums}, count(*)::float8 projects,
    count(*) filter (where mode = 'visual_vra')::float8 "visualProjects",
    count(*) filter (where status = 'active')::float8 "activeProjects",
    (select count(*)::float8 from users) users,
    (select count(*)::float8 from users where "createdAt" >= now() - interval '30 days') "newUsers30",
    (select count(*)::float8 from users where "lastSignedIn" >= now() - interval '30 days') "signedIn30",
    (select count(*)::float8 from users where "lastSignedIn" >= now() - interval '7 days') "signedIn7",
    (select count(*)::float8 from users where "documentQuotaUsed" >= ${FREE_DOCUMENT_LIMIT} and lower(trim(coalesce(email, ''))) <> 'adamamin2027@gmail.com') "cappedUsers"
  from metrics`;

export const trendQuery = sql`
  with days as (select generate_series((now() at time zone 'UTC')::date - 29,
    (now() at time zone 'UTC')::date, interval '1 day')::date as "day"),
  events as (
    select "createdAt"::date as "day", 'signup' kind from users where "createdAt" >= (now() at time zone 'UTC')::date - 29
    union all select "createdAt"::date, 'project' from projects where "createdAt" >= (now() at time zone 'UTC')::date - 29
    union all select "uploadedAt"::date, 'document' from documents where "uploadedAt" >= (now() at time zone 'UTC')::date - 29
    union all select "createdAt"::date, 'image' from visual_assets where "createdAt" >= (now() at time zone 'UTC')::date - 29
  ) select to_char(d.day, 'YYYY-MM-DD') as "day",
    count(*) filter (where e.kind = 'signup')::float8 signups,
    count(*) filter (where e.kind = 'project')::float8 projects,
    count(*) filter (where e.kind = 'document')::float8 documents,
    count(*) filter (where e.kind = 'image')::float8 images
    from days d left join events e on e.day = d.day group by d.day order by d.day`;

export function userFilter(search: string, cappedOnly: boolean): SQL {
  // Literal substring search; wildcard characters supplied by users stay literal.
  const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  return sql`(u.name ilike ${term} or u.email ilike ${term} or u.id::text = ${search} or ${search} = '')
    and (${!cappedOnly} or (u."documentQuotaUsed" >= ${FREE_DOCUMENT_LIMIT} and lower(trim(coalesce(u.email, ''))) <> 'adamamin2027@gmail.com'))`;
}

export function usersQuery(
  search: string,
  cappedOnly: boolean,
  page: number,
  limit: number
): SQL {
  return sql`with selected_users as (
    select u.id, u.name, u.email, u.plan, u."createdAt", u."lastSignedIn", u."documentQuotaUsed"
    from users u where ${userFilter(search, cappedOnly)} order by u."createdAt" desc, u.id desc limit ${limit} offset ${page * limit}
  ), ${projectMetrics(sql`p."userId" in (select id from selected_users)`)}
  select u.*, coalesce(m.projects, 0)::float8 projects, coalesce(m.documents, 0)::float8 documents,
    coalesce(m.assets, 0)::float8 assets, coalesce(m.transcriptions, 0)::float8 transcriptions,
    coalesce(m.bytes, 0)::float8 bytes,
    (select count(distinct pm."projectId")::float8 from project_members pm join projects p on p.id = pm."projectId"
      where pm."userId" = u.id and p."userId" <> u.id) "sharedProjects"
  from selected_users u left join (select "userId", count(*) projects, sum(documents) documents, sum(assets) assets,
    sum(transcriptions) transcriptions, sum(bytes) bytes from metrics group by "userId") m on m."userId" = u.id
  order by u."createdAt" desc, u.id desc`;
}

export function projectFilter(
  userId: number | undefined,
  search: string,
  mode: string
): SQL {
  const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  return sql`(${userId === undefined} or p."userId" = ${userId ?? 0} or exists
    (select 1 from project_members pm where pm."projectId" = p.id and pm."userId" = ${userId ?? 0}))
    and (p.name ilike ${term} or p.id::text = ${search} or ${search} = '')
    and (${mode === "all"} or coalesce((select vm."archiveMode"::text from visual_project_modes vm where vm."projectId" = p.id), 'document_transcription') = ${mode})`;
}

export function projectsQuery(
  userId: number | undefined,
  search: string,
  mode: string,
  page: number,
  limit: number
): SQL {
  return sql`with selected_projects as (select p.id from projects p where ${projectFilter(userId, search, mode)}
    order by p."createdAt" desc, p.id desc limit ${limit} offset ${page * limit}),
    ${projectMetrics(sql`p.id in (select id from selected_projects)`)}
    select m.*, u.name "ownerName", u.email "ownerEmail",
      case when m."userId" = ${userId ?? 0} then 'owner' else
        (select pm.role::text from project_members pm where pm."projectId" = m.id and pm."userId" = ${userId ?? 0}
          order by case pm.role when 'owner' then 0 when 'editor' then 1 else 2 end limit 1) end "userRole"
    from metrics m join users u on u.id = m."userId" order by m."createdAt" desc, m.id desc`;
}

export function membersQuery(
  projectId: number,
  page: number,
  limit: number
): SQL {
  return sql`with members as (
    select p."userId", 'owner' role from projects p where p.id = ${projectId}
    union all select pm."userId", pm.role::text from project_members pm join projects p on p.id = pm."projectId"
      where p.id = ${projectId} and pm."userId" <> p."userId"
  ), dedup as (select "userId", case min(case role when 'owner' then 0 when 'editor' then 1 else 2 end)
    when 0 then 'owner' when 1 then 'editor' else 'viewer' end role from members group by "userId")
  select u.id, u.name, u.email, d.role, count(*) over()::float8 total from dedup d join users u on u.id = d."userId"
    order by case d.role when 'owner' then 0 else 1 end, u.id limit ${limit} offset ${page * limit}`;
}

export function memberCountQuery(projectId: number): SQL {
  return sql`select count(distinct m.id)::float8 total from (
    select "userId" id from projects where id = ${projectId}
    union all select "userId" from project_members where "projectId" = ${projectId}
  ) m join users u on u.id = m.id`;
}
