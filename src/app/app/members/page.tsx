"use client";

import React, { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/lib/auth-client";

import {
  UserPlus,
  Search,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Mail,
  Clock,
  Loader2,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";


interface WorkspaceMemberData {
  id: string;
  workspaceId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    color: string;
    image?: string | null;
  };
}

interface WorkspaceInvitationData {
  id: string;
  email: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
  invitedBy: {
    id: string;
    name: string;
    email: string;
  };
}

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  currentUserRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
}

function MembersContent() {
  const searchParams = useSearchParams();
  const requestedWorkspaceId = searchParams.get("workspace");
  const { data: session } = useSession();

  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceInfo | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberData[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Invite modal state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "EDITOR" | "VIEWER">("EDITOR");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Remove confirmation modal
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMemberData | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Role edit state
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Initial workspace load
  useEffect(() => {
    async function fetchWorkspaces() {
      try {
        const res = await fetch("/api/workspaces");
        if (res.ok) {
          const json = await res.json();
          const list: WorkspaceInfo[] = json.data || [];
          setWorkspaces(list);

          if (list.length > 0) {
            const matched = requestedWorkspaceId
              ? list.find((w) => w.id === requestedWorkspaceId)
              : null;
            setSelectedWorkspace(matched || list[0]);
          }
        }
      } catch {
        // Fallback
      }
    }
    void fetchWorkspaces();
  }, [requestedWorkspaceId]);

  // Load members and invitations when selected workspace changes
  const loadWorkspaceData = useCallback(async (wsId: string) => {
    setLoading(true);
    setRoleError(null);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`/api/workspaces/${wsId}/members`),
        fetch(`/api/workspaces/${wsId}/invitations`),
      ]);

      if (membersRes.ok) {
        const json = await membersRes.json();
        setMembers(json.data || []);
      }

      if (invitesRes.ok) {
        const json = await invitesRes.json();
        setInvitations(json.data || []);
      } else {
        setInvitations([]);
      }
    } catch {
      // Graceful error state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedWorkspace?.id) {
      void loadWorkspaceData(selectedWorkspace.id);
    }
  }, [selectedWorkspace?.id, loadWorkspaceData]);

  // Permissions based on user role in active workspace
  const currentMember = useMemo(() => {
    if (!session?.user?.id) return null;
    return members.find((m) => m.userId === session.user.id);
  }, [members, session?.user?.id]);

  const userRole = currentMember?.role ?? selectedWorkspace?.currentUserRole ?? "VIEWER";
  const canAdmin = userRole === "OWNER" || userRole === "ADMIN";
  const isOwner = userRole === "OWNER";

  // Handle invitation creation
  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkspace || !inviteEmail.trim()) return;

    setInviting(true);
    setInviteError(null);
    try {
      const res = await fetch(`/api/workspaces/${selectedWorkspace.id}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const json = await res.json();

      if (!res.ok) {
        setInviteError(json.error || "Failed to create invitation.");
        return;
      }

      setGeneratedInviteUrl(json.data.inviteUrl);
      setInviteEmail("");
      void loadWorkspaceData(selectedWorkspace.id);
    } catch {
      setInviteError("Network error while creating invitation.");
    } finally {
      setInviting(false);
    }
  };

  // Handle invitation revocation
  const handleRevokeInvitation = async (invitationId: string) => {
    if (!selectedWorkspace) return;
    try {
      const res = await fetch(
        `/api/workspaces/${selectedWorkspace.id}/invitations/${invitationId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        void loadWorkspaceData(selectedWorkspace.id);
      }
    } catch {
      // Handled
    }
  };

  // Handle invitation resend / refresh
  const handleResendInvitation = async (invitationId: string) => {
    if (!selectedWorkspace) return;
    try {
      const res = await fetch(
        `/api/workspaces/${selectedWorkspace.id}/invitations/${invitationId}/resend`,
        { method: "POST" }
      );
      if (res.ok) {
        const json = await res.json();
        setGeneratedInviteUrl(json.data.inviteUrl);
        setInviteModalOpen(true);
        void loadWorkspaceData(selectedWorkspace.id);
      }
    } catch {
      // Handled
    }
  };

  // Handle role change
  const handleRoleChange = async (
    memberId: string,
    newRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER"
  ) => {
    if (!selectedWorkspace) return;
    setUpdatingRoleId(memberId);
    setRoleError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${selectedWorkspace.id}/members/${memberId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        }
      );
      const json = await res.json();

      if (!res.ok) {
        setRoleError(json.error || "Failed to update member role.");
        return;
      }

      void loadWorkspaceData(selectedWorkspace.id);
    } catch {
      setRoleError("Failed to update role due to network error.");
    } finally {
      setUpdatingRoleId(null);
    }
  };

  // Handle member removal
  const handleRemoveMember = async () => {
    if (!selectedWorkspace || !memberToRemove) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${selectedWorkspace.id}/members/${memberToRemove.id}`,
        { method: "DELETE" }
      );
      const json = await res.json();

      if (!res.ok) {
        setRemoveError(json.error || "Failed to remove member.");
        return;
      }

      setMemberToRemove(null);
      void loadWorkspaceData(selectedWorkspace.id);
    } catch {
      setRemoveError("Network error while removing member.");
    } finally {
      setRemoving(false);
    }
  };

  // Filter members
  const filteredMembers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.user.name.toLowerCase().includes(q) ||
        m.user.email.toLowerCase().includes(q)
    );
  }, [members, searchQuery]);

  return (
    <div className="container mx-auto max-w-5xl p-6 sm:p-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">
              {selectedWorkspace ? `${selectedWorkspace.name} — Members` : "Members & Roles"}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage team access, role assignments, and collaboration invitations.
          </p>
        </div>

        {canAdmin && (
          <Button
            size="sm"
            className="gap-2"
            onClick={() => {
              setGeneratedInviteUrl(null);
              setInviteError(null);
              setInviteModalOpen(true);
            }}
            data-testid="invite-member-button"
          >
            <UserPlus className="h-4 w-4" />
            <span>Invite Member</span>
          </Button>
        )}
      </div>

      {/* Role Error Notification Banner */}
      {roleError && (
        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{roleError}</span>
        </div>
      )}

      {/* Search and Workspace Selector */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members by name or email..."
            className="pl-9 h-9 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {workspaces.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Workspace:</span>
            <select
              className="h-9 rounded-md border bg-background px-3 text-xs"
              value={selectedWorkspace?.id || ""}
              onChange={(e) => {
                const target = workspaces.find((w) => w.id === e.target.value);
                if (target) setSelectedWorkspace(target);
              }}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Members Table */}
      <Card>
        <CardHeader className="pb-3 pt-5 px-6 border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Active Members</CardTitle>
              <CardDescription className="text-xs">
                {members.length} {members.length === 1 ? "member" : "members"} in this workspace
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Loading workspace members...</span>
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No members found matching your search.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 font-medium text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3">Member</th>
                    <th className="px-6 py-3">Role</th>
                    <th className="px-6 py-3">Presence Color</th>
                    <th className="px-6 py-3">Joined Date</th>
                    {canAdmin && <th className="px-6 py-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y text-foreground">
                  {filteredMembers.map((m) => {
                    const initials = m.user.name
                      ? m.user.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()
                      : "U";
                    const isSelf = m.userId === session?.user?.id;
                    const canEditThisMember =
                      canAdmin &&
                      (isOwner || (m.role !== "OWNER" && (m.role !== "ADMIN" || isSelf)));

                    return (
                      <tr key={m.id} className="hover:bg-muted/30 transition">
                        <td className="px-6 py-3.5 flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback
                              className="text-white text-[11px] font-semibold"
                              style={{ backgroundColor: m.user.color || "#6366F1" }}
                            >
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold flex items-center gap-2">
                              <span>{m.user.name}</span>
                              {isSelf && (
                                <Badge variant="outline" className="text-[9px] py-0 px-1">
                                  You
                                </Badge>
                              )}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{m.user.email}</p>
                          </div>
                        </td>
                        <td className="px-6 py-3.5">
                          {canEditThisMember && !isSelf ? (
                            <select
                              aria-label={`Change role for ${m.user.name}`}
                              value={m.role}
                              disabled={updatingRoleId === m.id}
                              onChange={(e) =>
                                void handleRoleChange(
                                  m.id,
                                  e.target.value as "OWNER" | "ADMIN" | "EDITOR" | "VIEWER"
                                )
                              }
                              className="h-7 rounded border bg-background px-2 text-xs font-medium cursor-pointer"
                            >
                              {isOwner && <option value="OWNER">OWNER</option>}
                              {isOwner && <option value="ADMIN">ADMIN</option>}
                              <option value="EDITOR">EDITOR</option>
                              <option value="VIEWER">VIEWER</option>
                            </select>
                          ) : (
                            <Badge
                              variant={
                                m.role === "OWNER"
                                  ? "default"
                                  : m.role === "ADMIN"
                                  ? "brand"
                                  : m.role === "EDITOR"
                                  ? "success"
                                  : "secondary"
                              }
                              className="text-[10px]"
                            >
                              {m.role}
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full border shadow-xs"
                              style={{ backgroundColor: m.user.color || "#6366F1" }}
                            />
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {m.user.color || "#6366F1"}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-muted-foreground">
                          {new Date(m.joinedAt).toLocaleDateString()}
                        </td>
                        {canAdmin && (
                          <td className="px-6 py-3.5 text-right">
                            {!isSelf && canEditThisMember && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive gap-1"
                                onClick={() => setMemberToRemove(m)}
                                data-testid={`remove-member-${m.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Remove</span>
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Invitations Section (Admins/Owners only) */}
      {canAdmin && (
        <Card>
          <CardHeader className="pb-3 pt-5 px-6 border-b">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>Pending & Recent Invitations</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Invitations sent to team members. Invitations expire after 7 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {invitations.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No active invitations. Click &quot;Invite Member&quot; to send an invitation.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40 font-medium text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3">Invitee Email</th>
                      <th className="px-6 py-3">Offered Role</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Expires</th>
                      <th className="px-6 py-3">Invited By</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-foreground">
                    {invitations.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/30 transition">
                        <td className="px-6 py-3.5 font-medium">{inv.email}</td>
                        <td className="px-6 py-3.5">
                          <Badge variant="outline" className="text-[10px]">
                            {inv.role}
                          </Badge>
                        </td>
                        <td className="px-6 py-3.5">
                          <Badge
                            variant={
                              inv.status === "PENDING"
                                ? "brand"
                                : inv.status === "ACCEPTED"
                                ? "success"
                                : "secondary"
                            }
                            className="text-[10px]"
                          >
                            {inv.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-3.5 text-muted-foreground">
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-3.5 text-muted-foreground">
                          {inv.invitedBy.name}
                        </td>
                        <td className="px-6 py-3.5 text-right space-x-1">
                          {inv.status === "PENDING" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => void handleResendInvitation(inv.id)}
                                title="Resend / Refresh invitation link"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Refresh</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive gap-1"
                                onClick={() => void handleRevokeInvitation(inv.id)}
                                title="Revoke invitation"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Revoke</span>
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invite Member Dialog */}
      <Dialog open={inviteModalOpen} onOpenChange={setInviteModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              <span>Invite Team Member</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Invite a new collaborator to {selectedWorkspace?.name}.
            </DialogDescription>
          </DialogHeader>

          {!generatedInviteUrl ? (
            <form onSubmit={handleCreateInvitation} className="space-y-4 pt-2">
              {inviteError && (
                <div className="p-2.5 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{inviteError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold">Recipient Email</label>
                <Input
                  type="email"
                  placeholder="collaborator@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="h-9 text-xs"
                  required
                  data-testid="invite-email-input"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold">Assigned Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as "ADMIN" | "EDITOR" | "VIEWER")
                  }
                  className="w-full h-9 rounded-md border bg-background px-3 text-xs"
                  data-testid="invite-role-select"
                >
                  {isOwner && <option value="ADMIN">ADMIN — Full workspace administration</option>}
                  <option value="EDITOR">EDITOR — Edit documents, whiteboards & projects</option>
                  <option value="VIEWER">VIEWER — View documents & whiteboards (read-only)</option>
                </select>
              </div>

              {/* Delivery notice */}
              <div className="p-3 rounded-md bg-muted/60 border text-[11px] text-muted-foreground flex items-start gap-2">
                <Mail className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                <span>
                  <strong>Email Delivery:</strong> Transactional email service is not configured.
                  An encrypted, copyable invitation link will be generated for you to share directly.
                </span>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setInviteModalOpen(false)}
                  disabled={inviting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={inviting} data-testid="generate-invite-button">
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span>Generate Invitation Link</span>
                  )}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs">
                Invitation created successfully! Copy this link and send it to your invitee:
              </div>

              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={generatedInviteUrl}
                  className="h-8 text-xs font-mono"
                  data-testid="generated-invite-url"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs shrink-0 gap-1.5"
                  onClick={() => {
                    void navigator.clipboard.writeText(generatedInviteUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2500);
                  }}
                  data-testid="copy-invite-link-button"
                >
                  {copiedLink ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </Button>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  onClick={() => {
                    setGeneratedInviteUrl(null);
                    setInviteModalOpen(false);
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation Dialog */}
      <Dialog
        open={!!memberToRemove}
        onOpenChange={(open) => !open && setMemberToRemove(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>Remove Team Member</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to remove <strong>{memberToRemove?.user.name}</strong> (
              {memberToRemove?.user.email}) from <strong>{selectedWorkspace?.name}</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="text-xs text-muted-foreground p-3 rounded-md bg-muted/40 border space-y-1">
            <p>Removing this member will:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Immediately revoke their access to all workspace projects and documents.</li>
              <li>Reject all subsequent Liveblocks room authentication tokens.</li>
              <li>Clear any explicit document and whiteboard permission overrides.</li>
            </ul>
          </div>

          {removeError && (
            <div className="p-2.5 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs">
              {removeError}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              onClick={() => setMemberToRemove(null)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveMember}
              disabled={removing}
              data-testid="confirm-remove-member-button"
            >
              {removing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span>Remove Member</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MembersPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-5xl p-6 sm:p-8 flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <MembersContent />
    </Suspense>
  );
}
