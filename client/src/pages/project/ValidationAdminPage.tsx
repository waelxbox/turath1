import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Plus, Copy, Link2, CheckCircle2, XCircle, Users,
  FileText, BarChart3, Loader2, X, Lock
} from "lucide-react";

interface Props {
  projectId: number;
}

export default function ValidationAdminPage({ projectId }: Props) {
  const [showCreate, setShowCreate] = useState(false);

  // Fetch existing sessions
  const sessionsQuery = trpc.validation.list.useQuery({ projectId });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Validation Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create review sessions to validate AI transcription accuracy
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Session
        </Button>
      </div>

      {/* Create session form */}
      {showCreate && (
        <CreateSessionForm
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            sessionsQuery.refetch();
          }}
        />
      )}

      {/* Sessions list */}
      {sessionsQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !sessionsQuery.data?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No validation sessions yet</p>
          <p className="text-sm mt-1">Create one to start validating AI accuracy</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessionsQuery.data.map((session) => (
            <SessionCard key={session.id} session={session} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Session Form ────────────────────────────────────────────────────

function CreateSessionForm({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [selectedDocs, setSelectedDocs] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch documents that have transcriptions
  const docsQuery = trpc.documents.list.useQuery({ projectId, status: "reviewed" });
  const createSession = trpc.validation.create.useMutation();

  const filteredDocs = (docsQuery.data ?? []).filter(
    (d) => !searchQuery || d.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error("Please enter a session title");
      return;
    }
    if (selectedDocs.size === 0) {
      toast.error("Please select at least one document");
      return;
    }

    try {
      const result = await createSession.mutateAsync({
        projectId,
        title: title.trim(),
        documentIds: Array.from(selectedDocs),
      });
      const fullLink = `${window.location.origin}${result.shareLink}`;
      await navigator.clipboard.writeText(fullLink);
      toast.success("Session created! Link copied to clipboard.");
      onCreated();
    } catch (err) {
      toast.error("Failed to create session");
    }
  };

  const toggleAll = () => {
    if (selectedDocs.size === filteredDocs.length) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(filteredDocs.map((d) => d.id)));
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 md:p-6 bg-card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">Create Validation Session</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div>
        <label className="text-sm text-muted-foreground mb-1 block">Session Title</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Recipe Collection Accuracy Test"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-muted-foreground">
            Select Documents ({selectedDocs.size} selected)
          </label>
          <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs">
            {selectedDocs.size === filteredDocs.length ? "Deselect All" : "Select All"}
          </Button>
        </div>

        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search documents..."
          className="mb-2"
        />

        <div className="max-h-60 overflow-y-auto border border-border rounded-md">
          {docsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No reviewed documents found
            </div>
          ) : (
            filteredDocs.map((doc) => (
              <label
                key={doc.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50 cursor-pointer border-b border-border last:border-0"
              >
                <input
                  type="checkbox"
                  checked={selectedDocs.has(doc.id)}
                  onChange={() => {
                    const next = new Set(selectedDocs);
                    if (next.has(doc.id)) next.delete(doc.id);
                    else next.add(doc.id);
                    setSelectedDocs(next);
                  }}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="text-sm text-foreground truncate">{doc.filename}</span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          disabled={createSession.isPending || !title.trim() || selectedDocs.size === 0}
          className="gap-2"
        >
          {createSession.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Create & Copy Link
        </Button>
      </div>
    </div>
  );
}

// ─── Session Card with Stats ────────────────────────────────────────────────

function SessionCard({
  session,
  projectId,
}: {
  session: {
    id: number;
    title: string;
    shareToken: string;
    totalDocs: number;
    reviewsPerDoc: number;
    status: string;
    createdAt: string | Date;
  };
  projectId: number;
}) {
  const [showStats, setShowStats] = useState(false);
  const statsQuery = trpc.validation.stats.useQuery(
    { sessionId: session.id },
    { enabled: showStats }
  );
  const closeSession = trpc.validation.close.useMutation();
  const utils = trpc.useUtils();

  const shareLink = `${window.location.origin}/review/${session.shareToken}`;

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareLink);
    toast.success("Link copied!");
  };

  const handleClose = async () => {
    if (!confirm("Close this session? Reviewers will no longer be able to submit reviews.")) return;
    await closeSession.mutateAsync({ sessionId: session.id });
    utils.validation.list.invalidate({ projectId });
    toast.success("Session closed");
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground truncate">{session.title}</h3>
            {session.status === "closed" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-red-500/20 text-red-400">
                <Lock className="w-3 h-3" /> Closed
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {session.totalDocs} documents · {session.reviewsPerDoc} reviewers each ·{" "}
            {new Date(session.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={copyLink} title="Copy link">
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowStats(!showStats)}
            title="View stats"
          >
            <BarChart3 className="w-4 h-4" />
          </Button>
          {session.status === "active" && (
            <Button variant="ghost" size="sm" onClick={handleClose} title="Close session">
              <Lock className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Share link display */}
      <div className="mt-3 flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
        <Link2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <code className="text-xs text-muted-foreground truncate flex-1">{shareLink}</code>
        <Button variant="ghost" size="sm" onClick={copyLink} className="h-6 px-2 text-xs">
          Copy
        </Button>
      </div>

      {/* Stats panel */}
      {showStats && (
        <div className="mt-4 border-t border-border pt-4">
          {statsQuery.isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : statsQuery.data ? (
            <StatsPanel stats={statsQuery.data} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No data yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stats Panel ────────────────────────────────────────────────────────────

interface ValidationStats {
  overallAccuracy: number | null;
  totalReviews: number;
  totalCorrect: number;
  totalIncorrect: number;
  uniqueReviewers: number;
  interRaterAgreement: number | null;
  multiReviewedLines: number;
  docsCompleted: number;
  totalDocs: number;
  reviewerStats: { username: string; docsCompleted: number; linesReviewed: number; correctCount: number; incorrectCount: number }[];
  docStats: { documentId: number; correct: number; incorrect: number; reviewerCount: number; accuracy: number | null }[];
}

function StatsPanel({ stats }: { stats: ValidationStats }) {
  if (!stats) return null;

  return (
    <div className="space-y-4">
      {/* Overview metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Overall Accuracy"
          value={stats.overallAccuracy != null ? `${(stats.overallAccuracy * 100).toFixed(1)}%` : "—"}
          icon={<CheckCircle2 className="w-4 h-4 text-green-400" />}
        />
        <MetricCard
          label="Total Reviews"
          value={stats.totalReviews.toString()}
          icon={<FileText className="w-4 h-4 text-blue-400" />}
        />
        <MetricCard
          label="Reviewers"
          value={stats.uniqueReviewers.toString()}
          icon={<Users className="w-4 h-4 text-purple-400" />}
        />
        <MetricCard
          label="Agreement Rate"
          value={stats.interRaterAgreement != null ? `${(stats.interRaterAgreement * 100).toFixed(1)}%` : "—"}
          icon={<BarChart3 className="w-4 h-4 text-orange-400" />}
        />
      </div>

      {/* Error breakdown */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-green-400">
          <CheckCircle2 className="w-3 h-3 inline mr-1" />
          {stats.totalCorrect} correct
        </span>
        <span className="text-red-400">
          <XCircle className="w-3 h-3 inline mr-1" />
          {stats.totalIncorrect} incorrect
        </span>
        <span className="text-muted-foreground">
          Docs complete: {stats.docsCompleted}/{stats.totalDocs}
        </span>
      </div>

      {/* Per-reviewer breakdown */}
      {stats.reviewerStats.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Reviewers</h4>
          <div className="space-y-1">
            {stats.reviewerStats.map((r) => (
              <div key={r.username} className="flex items-center justify-between text-xs bg-muted/30 rounded px-3 py-2">
                <span className="text-foreground font-medium">{r.username}</span>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{r.docsCompleted} docs</span>
                  <span>{r.linesReviewed} lines</span>
                  <span className="text-green-400">{r.correctCount}✓</span>
                  <span className="text-red-400">{r.incorrectCount}✗</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-document accuracy */}
      {stats.docStats.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Document Accuracy</h4>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {stats.docStats.map((d) => (
              <div key={d.documentId} className="flex items-center justify-between text-xs bg-muted/30 rounded px-3 py-2">
                <span className="text-muted-foreground">Doc #{d.documentId}</span>
                <div className="flex items-center gap-3">
                  <span className={d.accuracy != null && d.accuracy >= 0.9 ? "text-green-400" : d.accuracy != null && d.accuracy >= 0.7 ? "text-yellow-400" : "text-red-400"}>
                    {d.accuracy != null ? `${(d.accuracy * 100).toFixed(0)}%` : "—"}
                  </span>
                  <span className="text-muted-foreground">{d.reviewerCount}/{5} reviewers</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-muted/30 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-lg font-bold text-foreground">{value}</div>
    </div>
  );
}
