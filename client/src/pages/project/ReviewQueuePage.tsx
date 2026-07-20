import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, ListTodo, UserPlus, CheckCircle, Clock, Play, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function ReviewQueuePage({ projectId }: { projectId: number }) {
  const [showAssignDialog, setShowAssignDialog] = useState(false);

  // Get my queue
  const { data: myQueue, isLoading: loadingQueue } = trpc.assignments.myQueue.useQuery({ projectId });

  // Get all assignments (admin view)
  const { data: allAssignments, isLoading: loadingAll } = trpc.assignments.all.useQuery({ projectId });

  // Get stats
  const { data: stats } = trpc.assignments.stats.useQuery({ projectId });

  // Get project members for the assign dialog
  const { data: membersData } = trpc.members.list.useQuery({ projectId });
  const membersList = membersData && 'members' in membersData ? membersData.members : [];

  const utils = trpc.useUtils();

  const updateStatusMutation = trpc.assignments.updateStatus.useMutation({
    onSuccess: () => {
      utils.assignments.myQueue.invalidate();
      utils.assignments.all.invalidate();
      utils.assignments.stats.invalidate();
    },
  });

  const deleteMutation = trpc.assignments.delete.useMutation({
    onSuccess: () => {
      utils.assignments.all.invalidate();
      utils.assignments.stats.invalidate();
      toast.success("Assignment removed");
    },
  });

  const isLoading = loadingQueue || loadingAll;

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ListTodo className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold">Review Queue</h1>
        </div>
        <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <UserPlus className="w-4 h-4" />
              Assign Documents
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Documents</DialogTitle>
            </DialogHeader>
            <AssignForm
              projectId={projectId}
              members={membersList}
              onDone={() => {
                setShowAssignDialog(false);
                utils.assignments.all.invalidate();
                utils.assignments.stats.invalidate();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats summary */}
      {stats && Array.isArray(stats) && stats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {stats.map((s: any) => (
            <div key={s.assigneeId} className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">{s.assigneeName || `User #${s.assigneeId}`}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm font-medium">{s.total} assigned</span>
                <span className="text-xs text-green-400">{s.completed} done</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* My Queue */}
          {myQueue && myQueue.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">My Queue</h2>
              <div className="space-y-1">
                {myQueue.map((item: any) => (
                  <div key={item.id} className="flex items-center gap-3 py-2.5 px-3 rounded-md hover:bg-muted/30 transition-colors">
                    <StatusIcon status={item.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{item.documentFilename || `Doc #${item.documentId}`}</p>
                      <p className="text-xs text-muted-foreground">
                        Assigned {formatTimeAgo(item.createdAt)}
                      </p>
                    </div>
                    {item.status === "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-xs"
                        onClick={() => updateStatusMutation.mutate({
                          assignmentId: item.id,
                          projectId,
                          status: "in_progress",
                        })}
                      >
                        <Play className="w-3 h-3" /> Start
                      </Button>
                    )}
                    {item.status === "in_progress" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-xs text-green-400"
                        onClick={() => updateStatusMutation.mutate({
                          assignmentId: item.id,
                          projectId,
                          status: "completed",
                        })}
                      >
                        <CheckCircle className="w-3 h-3" /> Done
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* All Assignments */}
          {allAssignments && allAssignments.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">All Assignments</h2>
              <div className="space-y-1">
                {allAssignments.map((item: any) => (
                  <div key={item.id} className="flex items-center gap-3 py-2.5 px-3 rounded-md hover:bg-muted/30 transition-colors">
                    <StatusIcon status={item.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{item.documentFilename || `Doc #${item.documentId}`}</p>
                      <p className="text-xs text-muted-foreground">
                        → {item.assigneeName || `User #${item.assigneeId}`}
                        {" · "}
                        {formatTimeAgo(item.createdAt)}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-red-400"
                      onClick={() => {
                        if (confirm("Remove this assignment?")) {
                          deleteMutation.mutate({ assignmentId: item.id, projectId });
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(!myQueue || myQueue.length === 0) && (!allAssignments || allAssignments.length === 0) && (
            <div className="text-center py-20 text-muted-foreground">
              <ListTodo className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No assignments yet</p>
              <p className="text-xs mt-1">Assign documents to team members to distribute the review workload.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle className="w-4 h-4 text-green-400" />;
  if (status === "in_progress") return <Play className="w-4 h-4 text-yellow-400" />;
  return <Clock className="w-4 h-4 text-muted-foreground" />;
}

function AssignForm({ projectId, members, onDone }: { projectId: number; members: any[]; onDone: () => void }) {
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [docRange, setDocRange] = useState("");

  const assignMutation = trpc.assignments.assign.useMutation({
    onSuccess: (data) => {
      toast.success(`Assigned ${data.assigned} documents`);
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigneeId) { toast.error("Select a team member"); return; }
    if (!docRange.trim()) { toast.error("Enter document IDs"); return; }

    // Parse doc range: "1-50" or "1,2,3,4" or "1-10,15,20-25"
    const ids: number[] = [];
    const parts = docRange.split(",").map(s => s.trim());
    for (const part of parts) {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end; i++) ids.push(i);
        }
      } else {
        const n = Number(part);
        if (!isNaN(n)) ids.push(n);
      }
    }

    if (ids.length === 0) { toast.error("Invalid document range"); return; }

    assignMutation.mutate({
      projectId,
      documentIds: ids,
      assigneeId: Number(assigneeId),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div>
        <label className="text-sm font-medium mb-1.5 block">Assign to</label>
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger>
            <SelectValue placeholder="Select team member" />
          </SelectTrigger>
          <SelectContent>
            {members.map((m: any) => (
              <SelectItem key={m.userId} value={String(m.userId)}>
                {m.userName || m.userEmail || `User #${m.userId}`} ({m.role})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">Document IDs</label>
        <Input
          placeholder="e.g. 1-50 or 1,5,10,15-20"
          value={docRange}
          onChange={e => setDocRange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground mt-1">Enter ranges (1-50) or comma-separated IDs</p>
      </div>
      <Button type="submit" className="w-full" disabled={assignMutation.isPending}>
        {assignMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assign"}
      </Button>
    </form>
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
