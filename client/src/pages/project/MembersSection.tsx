import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, UserPlus, X, Users, Mail, Shield, Eye, Pencil, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  projectId: number;
}

export default function MembersSection({ projectId }: Props) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");

  const membersQuery = trpc.members.list.useQuery({ projectId });
  const inviteMutation = trpc.members.invite.useMutation({
    onSuccess: (data) => {
      if (data.autoAccepted) {
        toast.success("User added to project!");
      } else {
        toast.success("Invite sent! They'll get access when they sign in.");
      }
      setInviteEmail("");
      membersQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const removeMutation = trpc.members.remove.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      membersQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateRoleMutation = trpc.members.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      membersQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const cancelInviteMutation = trpc.members.cancelInvite.useMutation({
    onSuccess: () => {
      toast.success("Invite cancelled");
      membersQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate({ projectId, email: inviteEmail.trim(), role: inviteRole });
  };

  const isOwner = membersQuery.data?.currentUserRole === "owner";

  const roleIcon = (role: string) => {
    switch (role) {
      case "owner": return <Crown className="w-3.5 h-3.5 text-amber-400" />;
      case "editor": return <Pencil className="w-3.5 h-3.5 text-blue-400" />;
      case "viewer": return <Eye className="w-3.5 h-3.5 text-muted-foreground" />;
      default: return <Shield className="w-3.5 h-3.5" />;
    }
  };

  const roleBadgeVariant = (role: string) => {
    switch (role) {
      case "owner": return "default";
      case "editor": return "secondary";
      case "viewer": return "outline";
      default: return "outline";
    }
  };

  if (membersQuery.isLoading) {
    return (
      <div className="border-t border-border pt-6 mt-8">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Team Members</h3>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  const { members = [], invites = [], currentUserRole } = membersQuery.data ?? {};

  return (
    <div className="border-t border-border pt-6 mt-8">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Team Members</h3>
        <Badge variant="outline" className="ml-auto text-xs">
          {members.length + 1} member{members.length !== 0 ? "s" : ""}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Invite collaborators to help transcribe and review documents. Editors can upload, transcribe, and review. Viewers can only search and read.
      </p>

      {/* Invite Form (owner only) */}
      {isOwner && (
        <form onSubmit={handleInvite} className="flex gap-2 mb-6">
          <div className="flex-1">
            <Input
              type="email"
              placeholder="collaborator@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="h-9"
            />
          </div>
          <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "editor" | "viewer")}>
            <SelectTrigger className="w-28 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={inviteMutation.isPending || !inviteEmail.trim()} className="gap-1.5 h-9">
            {inviteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
            Invite
          </Button>
        </form>
      )}

      {/* Owner row */}
      <div className="space-y-1">
        <div className="flex items-center gap-3 py-2 px-3 rounded-md bg-muted/30">
          <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center">
            <Crown className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">You (Owner)</p>
          </div>
          <Badge variant={roleBadgeVariant("owner") as any} className="gap-1 text-xs">
            {roleIcon("owner")}
            Owner
          </Badge>
        </div>

        {/* Members list */}
        {members.map((member) => (
          <div key={member.id} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/20 group">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
              <span className="text-xs font-medium">
                {(member.userName || member.userEmail || "?").charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{member.userName || member.userEmail || "Unknown"}</p>
              {member.userEmail && member.userName && (
                <p className="text-xs text-muted-foreground truncate">{member.userEmail}</p>
              )}
            </div>
            {isOwner ? (
              <div className="flex items-center gap-2">
                <Select
                  value={member.role}
                  onValueChange={(v) => updateRoleMutation.mutate({ projectId, userId: member.userId, role: v as "editor" | "viewer" })}
                >
                  <SelectTrigger className="w-24 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100"
                  onClick={() => removeMutation.mutate({ projectId, userId: member.userId })}
                >
                  <X className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            ) : (
              <Badge variant={roleBadgeVariant(member.role) as any} className="gap-1 text-xs">
                {roleIcon(member.role)}
                {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
              </Badge>
            )}
          </div>
        ))}

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="mt-4">
            <Label className="text-xs text-muted-foreground mb-2 block">Pending Invites</Label>
            {invites.map((invite) => (
              <div key={invite.id} className="flex items-center gap-3 py-2 px-3 rounded-md bg-muted/10 group">
                <div className="w-7 h-7 rounded-full bg-muted/50 flex items-center justify-center">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{invite.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Invited as {invite.role} · Expires {new Date(invite.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100"
                    onClick={() => cancelInviteMutation.mutate({ projectId, inviteId: invite.id })}
                  >
                    <X className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {members.length === 0 && invites.length === 0 && (
          <p className="text-xs text-muted-foreground py-3 text-center">
            No collaborators yet. Invite someone to get started.
          </p>
        )}
      </div>
    </div>
  );
}
