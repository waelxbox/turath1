import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, Activity, Upload, Eye, CheckCircle, Flag, Network, Users, Zap, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ACTION_LABELS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  document_uploaded: { label: "Uploaded", icon: Upload, color: "text-blue-600 dark:text-blue-400" },
  document_transcribed: { label: "Transcribed", icon: Zap, color: "text-purple-400" },
  document_reviewed: { label: "Reviewed", icon: Eye, color: "text-yellow-700 dark:text-yellow-400" },
  document_approved: { label: "Approved", icon: CheckCircle, color: "text-green-700 dark:text-green-400" },
  document_flagged: { label: "Flagged", icon: Flag, color: "text-red-600 dark:text-red-400" },
  document_assigned: { label: "Assigned", icon: Users, color: "text-cyan-400" },
  entity_created: { label: "Entity created", icon: Network, color: "text-emerald-400" },
  entity_merged: { label: "Entities merged", icon: Network, color: "text-amber-700 dark:text-amber-400" },
  entity_deleted: { label: "Entity deleted", icon: Network, color: "text-red-600 dark:text-red-400" },
  validation_session_created: { label: "Validation created", icon: Activity, color: "text-indigo-600 dark:text-indigo-400" },
  validation_verdict_submitted: { label: "Verdict submitted", icon: CheckCircle, color: "text-teal-400" },
  project_member_invited: { label: "Member invited", icon: Users, color: "text-blue-600 dark:text-blue-400" },
  project_member_joined: { label: "Member joined", icon: Users, color: "text-green-700 dark:text-green-400" },
  batch_started: { label: "Batch started", icon: Zap, color: "text-orange-700 dark:text-orange-400" },
  batch_completed: { label: "Batch completed", icon: CheckCircle, color: "text-green-700 dark:text-green-400" },
};

export default function ActivityFeedPage({ projectId }: { projectId: number }) {
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const limit = 30;

  const { data, isLoading } = trpc.activity.feed.useQuery({
    projectId,
    limit,
    offset: page * limit,
    action: actionFilter === "all" ? undefined : actionFilter,
  });

  const items = data && 'items' in data ? data.items : [];
  const feed = items;

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold">Activity</h1>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="document_uploaded">Uploads</SelectItem>
              <SelectItem value="document_transcribed">Transcriptions</SelectItem>
              <SelectItem value="document_reviewed">Reviews</SelectItem>
              <SelectItem value="document_approved">Approvals</SelectItem>
              <SelectItem value="document_flagged">Flags</SelectItem>
              <SelectItem value="document_assigned">Assignments</SelectItem>
              <SelectItem value="entity_created">Entity created</SelectItem>
              <SelectItem value="entity_merged">Entity merged</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : feed.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Activity className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No activity yet</p>
          <p className="text-xs mt-1">Actions will appear here as your team works on this project.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {feed.map((item: any) => {
            const actionInfo = ACTION_LABELS[item.action] ?? { label: item.action, icon: Activity, color: "text-muted-foreground" };
            const Icon = actionInfo.icon;
            const timeAgo = formatTimeAgo(item.createdAt);

            return (
              <div key={item.id} className="flex items-start gap-3 py-3 px-3 rounded-md hover:bg-muted/30 transition-colors">
                <div className={`mt-0.5 ${actionInfo.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium text-foreground">{item.userName || "System"}</span>
                    {" "}
                    <span className="text-muted-foreground">{actionInfo.label.toLowerCase()}</span>
                    {item.metadata?.filename && (
                      <span className="text-foreground/80"> — {item.metadata.filename}</span>
                    )}
                    {item.metadata?.count && item.metadata.count > 1 && (
                      <span className="text-muted-foreground"> ({item.metadata.count} docs)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{timeAgo}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {feed.length > 0 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page + 1}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={items.length < limit}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
