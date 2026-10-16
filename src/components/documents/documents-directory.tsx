"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  Plus,
  Search,
  ArrowUpRight,
  Loader2,
  FolderKanban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface DocumentListItem {
  id: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  projectName: string | null;
  liveblocksRoomId: string;
  updatedAtIso: string;
  authorName: string;
  authorColor: string;
}

export interface WorkspaceOption {
  id: string;
  name: string;
  role: string;
}

function getInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}

export function DocumentsDirectoryClient({
  initialDocuments,
  workspaces,
  isAuthenticated,
}: {
  initialDocuments: DocumentListItem[];
  workspaces: WorkspaceOption[];
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    workspaces[0]?.id ?? ""
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const editableWorkspaces = useMemo(
    () => workspaces.filter((ws) => ws.role !== "VIEWER"),
    [workspaces]
  );

  const filteredDocuments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return initialDocuments;
    return initialDocuments.filter(
      (doc) =>
        doc.title.toLowerCase().includes(q) ||
        doc.workspaceName.toLowerCase().includes(q) ||
        (doc.projectName && doc.projectName.toLowerCase().includes(q))
    );
  }, [initialDocuments, searchQuery]);

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    const targetWorkspaceId =
      selectedWorkspaceId || editableWorkspaces[0]?.id || "";
    if (!targetWorkspaceId) {
      setCreateError("Select a workspace where you have Editor permissions.");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: targetWorkspaceId,
          type: "DOCUMENT",
          title: newDocTitle.trim() || "Untitled Specification",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCreateError(json.error || "Failed to create document.");
        setCreating(false);
        return;
      }
      setCreateDialogOpen(false);
      setNewDocTitle("");
      router.push(`/app/documents/${json.data.id}`);
      router.refresh();
    } catch {
      setCreateError("Network error while creating document.");
      setCreating(false);
    }
  };

  return (
    <div className="container mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Concurrent rich-text technical documentation powered by Tiptap, Yjs,
            and Liveblocks.
          </p>
        </div>

        {isAuthenticated && editableWorkspaces.length > 0 ? (
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="gap-2"
                data-testid="create-document-btn"
              >
                <Plus className="h-4 w-4" />
                <span>New Document</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create Collaborative Document</DialogTitle>
                <DialogDescription className="text-xs">
                  Provision a new PostgreSQL-persisted Tiptap document with a
                  dedicated Liveblocks Yjs room.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateDocument} className="space-y-4 pt-2">
                {editableWorkspaces.length > 1 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Workspace</label>
                    <select
                      value={selectedWorkspaceId}
                      onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                      className="w-full h-9 rounded-md border bg-background px-3 text-xs"
                    >
                      {editableWorkspaces.map((ws) => (
                        <option key={ws.id} value={ws.id}>
                          {ws.name} ({ws.role})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Document Title</label>
                  <Input
                    placeholder="e.g. RFC-042: Distributed State Sync"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    autoFocus
                    data-testid="new-document-title-input"
                  />
                </div>
                {createError && (
                  <p className="text-xs text-destructive">{createError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreateDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={creating}
                    data-testid="confirm-create-document-btn"
                  >
                    {creating && (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    )}
                    Create & Open Editor
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : (
          <Link href="/app">
            <Button size="sm" variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              <span>Go to Workspace</span>
            </Button>
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter documents by title, project, or workspace..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="documents-search-input"
          />
        </div>
      </div>

      {filteredDocuments.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-2">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="text-sm font-semibold">No documents found</div>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {searchQuery
              ? "No documents match your filter criteria."
              : "Create your first collaborative rich-text specification in your workspace to start editing."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredDocuments.map((doc) => (
            <Link
              key={doc.id}
              href={`/app/documents/${doc.id}`}
              className="group"
              data-testid={`document-card-${doc.id}`}
            >
              <Card className="h-full border bg-card hover:border-primary/40 hover:shadow-sm transition">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="brand" className="text-[10px] h-5 px-1.5">
                        <FileText className="h-3 w-3 mr-1" />
                        Document
                      </Badge>
                      <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                        {doc.workspaceName}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {doc.liveblocksRoomId}
                    </span>
                  </div>
                  <CardTitle className="text-sm font-semibold group-hover:text-primary transition line-clamp-1">
                    {doc.title}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground flex items-center gap-1">
                    {doc.projectName ? (
                      <>
                        <FolderKanban className="h-3 w-3" />
                        <span>{doc.projectName}</span>
                      </>
                    ) : (
                      <span>Workspace Root</span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2 border-t mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-4 w-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
                      style={{ backgroundColor: doc.authorColor }}
                    >
                      {getInitials(doc.authorName)}
                    </div>
                    <span>{doc.authorName}</span>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition text-primary" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
