import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  estimateCost,
  isPlatformOwner,
  type CostRates,
  type CostWorkload,
} from "@shared/admin";
import { getLoginUrl } from "@/const";

const number = (n: number) => n.toLocaleString();
const date = (s: string) =>
  new Date(s).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
const usd = (n: number | null) =>
  n === null
    ? "Set rates"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(n);
const size = (n: number) =>
  n < 1_000_000
    ? `${(n / 1_000).toFixed(1)} KB`
    : n < 1_000_000_000
      ? `${(n / 1_000_000).toFixed(1)} MB`
      : `${(n / 1_000_000_000).toFixed(2)} GB`;
const label = (s: string) => s.replaceAll("_", " ");
const limit = 25;
type SelectedUser = { id: number; name: string | null; email: string | null };

function Loading() {
  return (
    <div
      className="flex items-center justify-center gap-2 p-12 text-muted-foreground"
      role="status"
    >
      <Loader2 className="h-5 w-5 animate-spin" /> Loading metrics…
    </div>
  );
}
function Failure({ retry }: { retry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
    >
      <p>Couldn’t load these metrics. Check your connection and try again.</p>
      <Button variant="outline" className="mt-3" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}
function Metric({
  name,
  value,
  note,
}: {
  name: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-xs font-medium text-muted-foreground">{name}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
function Pages({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
      <span className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0
          ? "No results"
          : `${number(page * limit + 1)}–${number(Math.min((page + 1) * limit, total))} of ${number(total)}`}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={(page + 1) * limit >= total}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
function Cost({ work, rates }: { work: CostWorkload; rates: CostRates }) {
  const c = estimateCost(work, rates);
  return (
    <div className="text-sm tabular-nums">
      <div>{usd(c.processing)}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Storage: {usd(c.storageMonthly)}/mo
      </div>
    </div>
  );
}
function Rates({
  rates,
  setRates,
}: {
  rates: CostRates;
  setRates: (r: CostRates) => void;
}) {
  return (
    <details className="rounded-xl border bg-card p-5">
      <summary className="cursor-pointer text-sm font-medium">
        Cost assumptions · USD · click to configure
      </summary>
      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        TURATH does not retain a complete token or billing ledger. Enter your
        own average rates to estimate processing for retained records and
        monthly storage for original files. These are planning estimates, not
        actual spend. Rates apply consistently to the overview, users and
        projects and reset when you reload.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {(
          [
            ["transcription", "USD per saved transcription"],
            ["visualAsset", "USD per visual asset intake"],
            ["storageGbMonth", "USD per GB per month"],
          ] as const
        ).map(([key, title]) => (
          <label className="space-y-2 text-xs" key={key}>
            <span>{title}</span>
            <Input
              type="number"
              min="0"
              max="100000"
              step="any"
              placeholder="Enter average rate"
              value={rates[key] ?? ""}
              onChange={e => {
                const n = e.target.valueAsNumber;
                setRates({
                  ...rates,
                  [key]: Number.isFinite(n) && n >= 0 && n <= 100000 ? n : null,
                });
              }}
            />
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Processing = saved transcriptions × transcription rate + retained visual
        assets × intake rate. Storage uses decimal GB. Excludes chat,
        onboarding, retries, cross-checks, deleted records, embeddings, image
        derivatives, database and hosting overhead, taxes and provider
        discounts. A zero rate explicitly excludes that category. Historical
        work is attributed to the current project owner.
      </p>
    </details>
  );
}

function Overview({ rates }: { rates: CostRates }) {
  const query = trpc.admin.overview.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (query.isError) return <Failure retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const { totals: t, trend } = query.data;
  const c = estimateCost(t, rates);
  const max = Math.max(1, ...trend.map(d => d.signups));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Current retained data · refreshed{" "}
          {new Date(query.data.generatedAt).toLocaleTimeString()}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw
            className={`mr-2 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`}
          />{" "}
          Refresh overview
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          name="Registered users"
          value={number(t.users)}
          note={`${number(t.newUsers30)} joined in the last 30 days`}
        />
        <Metric
          name="Users signed in · last 30 days"
          value={number(t.signedIn30)}
          note={`${number(t.signedIn7)} in the last 7 days; based on each account's latest sign-in`}
        />
        <Metric
          name="Projects"
          value={number(t.projects)}
          note={`${number(t.visualProjects)} visual · ${number(t.projects - t.visualProjects)} document · ${number(t.activeProjects)} active status`}
        />
        <Metric
          name="Users at document cap"
          value={number(t.cappedUsers)}
          note="20+ quota uploads; owner excluded"
        />
        <Metric
          name="Document files"
          value={number(t.documents)}
          note={`${number(t.transcriptions)} saved transcriptions · ${number(t.reviewed)} reviewed files`}
        />
        <Metric
          name="Visual assets"
          value={number(t.assets)}
          note={`${number(t.records)} VRA records · ${number(t.approvedRecords)} approved`}
        />
        <Metric
          name="Estimated processing"
          value={usd(c.processing)}
          note="Retained workload × your rates; excludes unmetered activity"
        />
        <Metric
          name="Known original storage"
          value={size(t.bytes)}
          note={`${usd(c.storageMonthly)}/month estimate · ${number(t.unknownSize)} documents have unknown size`}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">New signups · 30 days</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Daily counts, UTC
          </p>
          <div className="mt-5 flex h-24 items-end gap-1" aria-hidden="true">
            {trend.map(d => (
              <div
                key={d.day}
                title={`${d.day}: ${d.signups} signups`}
                className="flex-1 rounded-t bg-primary/75"
                style={{
                  height: `${Math.max(2, (d.signups / max) * 100)}%`,
                  opacity: d.signups === 0 ? 0.15 : 1,
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>{trend[0]?.day}</span>
            <span>{trend.at(-1)?.day}</span>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs">
              View daily signup and intake counts
            </summary>
            <div className="mt-3 max-h-64 overflow-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  Daily signups, new projects, document uploads and visual
                  uploads, UTC
                </caption>
                <thead>
                  <tr>
                    {["Date", "Signups", "Projects", "Docs", "Images"].map(
                      x => (
                        <th className="p-2" scope="col" key={x}>
                          {x}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {trend.map(d => (
                    <tr className="border-t" key={d.day}>
                      <td className="p-2">{d.day}</td>
                      <td className="p-2">{d.signups}</td>
                      <td className="p-2">{d.projects}</td>
                      <td className="p-2">{d.documents}</td>
                      <td className="p-2">{d.images}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Operations</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Documents awaiting review / flagged", t.reviewQueue],
              ["Visual records needing review", t.recordReviewQueue],
              [
                "Document errors / failed visual assets",
                `${t.errors} / ${t.assetErrors}`,
              ],
              ["Queued / running jobs", `${t.queuedJobs} / ${t.runningJobs}`],
              ["Failed jobs (retained history)", t.failedJobs],
              ["Documents marked processing", t.processing],
              ["Saved research conversations", t.conversations],
            ].map(([name, value]) => (
              <div className="flex justify-between gap-4" key={name}>
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Counts describe stored statuses, not a live worker health check.
            Deleted data is absent. Conversations are retained threads, not all
            chat requests.
          </p>
        </section>
      </div>
    </div>
  );
}

function Users({
  rates,
  selectUser,
}: {
  rates: CostRates;
  selectUser: (u: SelectedUser) => void;
}) {
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cappedOnly, setCappedOnly] = useState(false);
  const query = trpc.admin.users.useQuery(
    { page, limit, search, cappedOnly },
    { staleTime: 30_000, retry: false, refetchOnWindowFocus: false }
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-serif font-semibold">Users</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Newest signups first. Usage and cost belong to owned projects.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh users
        </Button>
      </div>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={e => {
          e.preventDefault();
          setSearch(draft.trim());
          setPage(0);
        }}
      >
        <Input
          className="max-w-sm"
          maxLength={200}
          placeholder="Search name, email or user ID"
          aria-label="Search users"
          value={draft}
          onChange={e => setDraft(e.target.value)}
        />
        <Button variant="secondary" type="submit">
          Search
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cappedOnly}
            onChange={e => {
              setCappedOnly(e.target.checked);
              setPage(0);
            }}
          />{" "}
          At document cap
        </label>
      </form>
      {query.isError ? (
        <Failure retry={() => void query.refetch()} />
      ) : !query.data ? (
        <Loading />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">
                Registered users and owned-project usage
              </caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {[
                    "User",
                    "Joined / last sign-in",
                    "Projects",
                    "Quota uploads",
                    "Docs / images",
                    "Estimated cost",
                    "Details",
                  ].map(s => (
                    <th scope="col" className="p-4 font-medium" key={s}>
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map(u => (
                  <tr key={u.id} className="border-t hover:bg-muted/20">
                    <td className="p-4">
                      <p className="font-medium">{u.name || "Unnamed user"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {u.email || "No email"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        #{u.id} · {u.plan}
                      </p>
                    </td>
                    <td className="p-4 text-xs">
                      {date(u.createdAt)}
                      <p className="mt-1 text-muted-foreground">
                        {date(u.lastSignedIn)}
                      </p>
                    </td>
                    <td className="p-4">
                      {u.projects} owned
                      <p className="mt-1 text-xs text-muted-foreground">
                        {u.sharedProjects} shared
                      </p>
                    </td>
                    <td className="p-4 tabular-nums">
                      {u.documentQuotaUsed}
                      <p className="text-xs text-muted-foreground">
                        Lifetime counter
                      </p>
                    </td>
                    <td className="p-4 tabular-nums">
                      {u.documents} / {u.assets}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {size(u.bytes)}
                      </p>
                    </td>
                    <td className="p-4">
                      <Cost work={u} rates={rates} />
                    </td>
                    <td className="p-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`View projects for ${u.email || u.name || u.id}`}
                        onClick={() => selectUser(u)}
                      >
                        Projects <ArrowRight className="ml-1 h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {query.data.total === 0 && (
              <p className="p-10 text-center text-muted-foreground">
                No users match these filters.
              </p>
            )}
          </div>
          <Pages page={page} total={query.data.total} setPage={setPage} />
        </div>
      )}
    </section>
  );
}

function Members({ projectId }: { projectId: number }) {
  const [page, setPage] = useState(0);
  const query = trpc.admin.members.useQuery(
    { projectId, page, limit },
    { staleTime: 30_000, retry: false }
  );
  if (query.isError) return <Failure retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  return (
    <div className="mt-4 rounded-lg border">
      <ul className="divide-y">
        {query.data.rows.map(m => (
          <li
            key={m.id}
            className="flex flex-wrap justify-between gap-2 p-3 text-sm"
          >
            <span>
              {m.name || "Unnamed user"}
              <span className="ml-2 text-muted-foreground">
                {m.email || `User #${m.id}`}
              </span>
            </span>
            <span className="capitalize text-muted-foreground">{m.role}</span>
          </li>
        ))}
      </ul>
      {query.data.rows.length === 0 && (
        <p className="p-3 text-sm">No members on this page.</p>
      )}
      <Pages page={page} total={query.data.total} setPage={setPage} />
    </div>
  );
}

function Projects({
  rates,
  user,
  clearUser,
}: {
  rates: CostRates;
  user: SelectedUser | null;
  clearUser: () => void;
}) {
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<
    "all" | "document_transcription" | "visual_vra"
  >("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const query = trpc.admin.projects.useQuery(
    { userId: user?.id, page, limit, search, mode },
    { staleTime: 30_000, retry: false, refetchOnWindowFocus: false }
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-xl font-serif font-semibold">
            {user
              ? `Projects for ${user.name || user.email || `user #${user.id}`}`
              : "All projects"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {user
              ? `${user.email || "No email"} · owned projects and memberships; shared project costs belong to their owner.`
              : "Every project, including document and visual archives. Newest first."}
          </p>
        </div>
        <div className="flex gap-2">
          {user && (
            <Button variant="ghost" size="sm" onClick={clearUser}>
              <X className="mr-1 h-4 w-4" />
              Clear user
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh projects
          </Button>
        </div>
      </div>
      <form
        className="flex flex-wrap gap-3"
        onSubmit={e => {
          e.preventDefault();
          setSearch(draft.trim());
          setPage(0);
          setExpanded(null);
        }}
      >
        <Input
          className="max-w-sm"
          maxLength={200}
          placeholder="Search project name or ID"
          aria-label="Search projects"
          value={draft}
          onChange={e => setDraft(e.target.value)}
        />
        <Button variant="secondary" type="submit">
          Search
        </Button>
        <select
          aria-label="Archive mode"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={mode}
          onChange={e => {
            setMode(e.target.value as typeof mode);
            setPage(0);
            setExpanded(null);
          }}
        >
          <option value="all">All archive modes</option>
          <option value="document_transcription">Document archives</option>
          <option value="visual_vra">Visual archives</option>
        </select>
      </form>
      {query.isError ? (
        <Failure retry={() => void query.refetch()} />
      ) : !query.data ? (
        <Loading />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="divide-y">
            {query.data.rows.map(p => (
              <article key={p.id} className="p-5">
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      #{p.id} ·{" "}
                      {p.mode === "visual_vra"
                        ? "Visual archive"
                        : "Document archive"}{" "}
                      · {label(p.status)}
                      {p.userRole ? ` · ${p.userRole} access` : ""}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Owner: {p.ownerName || "Unnamed user"} ·{" "}
                      {p.ownerEmail || "No email"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {date(p.createdAt)} · Project settings updated{" "}
                      {date(p.updatedAt)}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      Estimated processing
                    </p>
                    <Cost work={p} rates={rates} />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
                  {[
                    ["Documents", p.documents],
                    ["Images / VRA records", `${p.assets} / ${p.records}`],
                    ["Saved transcriptions", p.transcriptions],
                    ["Original storage", size(p.bytes)],
                    ["Members incl. owner", p.members],
                    ["Saved conversations", p.conversations],
                  ].map(([name, value]) => (
                    <div key={name}>
                      <div className="text-xs text-muted-foreground">
                        {name}
                      </div>
                      <div className="mt-1 font-medium tabular-nums">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Review backlog: {p.reviewQueue} documents /{" "}
                  {p.recordReviewQueue} VRA records · Errors: {p.errors}{" "}
                  documents / {p.assetErrors} images · Jobs: {p.queuedJobs}{" "}
                  queued / {p.runningJobs} running / {p.failedJobs} failed
                  {p.unknownSize > 0
                    ? ` · ${p.unknownSize} documents have unknown size`
                    : ""}
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  aria-expanded={expanded === p.id}
                  onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                >
                  {expanded === p.id ? "Hide members" : "View members"}
                </Button>
                {expanded === p.id && <Members key={p.id} projectId={p.id} />}
              </article>
            ))}
          </div>
          {query.data.total === 0 && (
            <p className="p-10 text-center text-muted-foreground">
              No projects match these filters.
            </p>
          )}
          <Pages
            page={page}
            total={query.data.total}
            setPage={n => {
              setPage(n);
              setExpanded(null);
            }}
          />
        </div>
      )}
    </section>
  );
}

function Content() {
  const [view, setView] = useState<"users" | "projects">("users");
  const [user, setUser] = useState<SelectedUser | null>(null);
  const [rates, setRates] = useState<CostRates>({
    transcription: null,
    visualAsset: null,
    storageGbMonth: null,
  });
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-primary">
          <ShieldCheck className="h-4 w-4" /> Owner administration
        </div>
        <h1 className="font-serif text-3xl font-semibold">
          TURATH at a glance
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          People, collections and operations across the platform.
        </p>
      </div>
      <Rates rates={rates} setRates={setRates} />
      <Overview rates={rates} />
      <div
        className="flex gap-2 border-b pb-3"
        role="group"
        aria-label="Browse administration data"
      >
        <Button
          variant={view === "users" ? "default" : "ghost"}
          aria-pressed={view === "users"}
          onClick={() => setView("users")}
        >
          Users
        </Button>
        <Button
          variant={view === "projects" ? "default" : "ghost"}
          aria-pressed={view === "projects"}
          onClick={() => {
            setView("projects");
            setUser(null);
          }}
        >
          All projects
        </Button>
      </div>
      {view === "users" ? (
        <Users
          rates={rates}
          selectUser={u => {
            setUser(u);
            setView("projects");
          }}
        />
      ) : (
        <Projects
          key={user?.id ?? "all"}
          rates={rates}
          user={user}
          clearUser={() => setUser(null)}
        />
      )}
    </main>
  );
}

export default function AdminDashboard() {
  const auth = useAuth();
  const access = trpc.admin.access.useQuery(undefined, {
    enabled: !!auth.user,
    retry: false,
    staleTime: 0,
  });
  const cache = useQueryClient();
  useEffect(() => {
    if (!auth.loading && !isPlatformOwner(auth.user?.email)) {
      // Remove cross-user admin data from memory on sign-out/access loss.
      cache.removeQueries({ queryKey: getQueryKey(trpc.admin.overview) });
      cache.removeQueries({ queryKey: getQueryKey(trpc.admin.users) });
      cache.removeQueries({ queryKey: getQueryKey(trpc.admin.projects) });
      cache.removeQueries({ queryKey: getQueryKey(trpc.admin.members) });
    }
  }, [auth.loading, auth.user?.email, cache]);
  let body: ReactNode;
  if (auth.loading || (auth.user && access.isLoading)) body = <Loading />;
  else if (auth.error || access.isError)
    body = (
      <div className="mx-auto max-w-xl p-8">
        <Failure
          retry={() => {
            void auth.refresh();
            void access.refetch();
          }}
        />
      </div>
    );
  else if (!auth.user)
    body = (
      <div className="p-12 text-center">
        <h1 className="text-xl font-semibold">Sign in to continue</h1>
        <Button
          className="mt-4"
          onClick={() => {
            window.location.href = getLoginUrl();
          }}
        >
          Sign in
        </Button>
      </div>
    );
  else if (!access.data?.allowed || !isPlatformOwner(auth.user.email))
    body = (
      <div className="p-12 text-center">
        <h1 className="text-xl font-semibold">Owner access required</h1>
        <p className="mt-2 text-muted-foreground">
          This dashboard is restricted to the TURATH platform owner.
        </p>
      </div>
    );
  else body = <Content />;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm">
            <ArrowLeft className="h-4 w-4" />
            Your projects
          </Link>
          <span className="font-serif text-lg font-semibold">TURATH</span>
          <span className="text-xs text-muted-foreground">Administration</span>
        </div>
      </header>
      {body}
    </div>
  );
}
