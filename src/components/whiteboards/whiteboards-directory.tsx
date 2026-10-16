"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PenTool,
  Plus,
  Search,
  ArrowUpRight,
  Loader2,
  FolderKanban,
  Layout,
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

export interface WhiteboardListItem {
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
      .slice(0, 2) || "WB"
  );
}

export function WhiteboardsDirectoryClient({
  initialWhiteboards,
  workspaces,
  isAuthenticated,
}: {
  initialWhiteboards: WhiteboardListItem[];
  workspaces: WorkspaceOption[];
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    workspaces[0]?.id ?? ""
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const editableWorkspaces = useMemo(
    () => workspaces.filter((ws) => ws.role !== "VIEWER"),
    [workspaces]
  );

  const filteredWhiteboards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return initialWhiteboards;
    return initialWhiteboards.filter(
      (board) =>
        board.title.toLowerCase().includes(q) ||
        board.workspaceName.toLowerCase().includes(q) ||
        (board.projectName && board.projectName.toLowerCase().includes(q))
    );
  }, [initialWhiteboards, searchQuery]);

  const handleCreateWhiteboard = async (e: React.FormEvent) => {
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
          type: "WHITEBOARD",
          title: newBoardTitle.trim() || "Untitled Whiteboard",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCreateError(json.error || "Failed to create whiteboard.");
        setCreating(false);
        return;
      }
      setCreateDialogOpen(false);
      setNewBoardTitle("");
      router.push(`/app/whiteboards/${json.data.id}`);
      router.refresh();
    } catch {
      setCreateError("Network error while creating whiteboard.");
      setCreating(false);
    }
  };

  return (
    <div className="container mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Whiteboards</h1>
          <p className="text-sm text-muted-foreground">
            Multiplayer visual canvases powered by Excalidraw and Liveblocks
            with element-level CRDT synchronization.
          </p>
        </div>

        {isAuthenticated && editableWorkspaces.length > 0 ? (
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="gap-2"
                data-testid="create-whiteboard-btn"
              >
                <Plus className="h-4 w-4" />
                <span>New Whiteboard</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create Collaborative Whiteboard</DialogTitle>
                <DialogDescription className="text-xs">
                  Provision a new PostgreSQL-persisted Excalidraw whiteboard
                  with a dedicated Liveblocks room.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={handleCreateWhiteboard}
                className="space-y-4 pt-2"
              >
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
                  <label className="text-xs font-medium">Whiteboard Title</label>
                  <Input
                    placeholder="e.g. Distributed System Architecture Diagram"
                    value={newBoardTitle}
                    onChange={(e) => setNewBoardTitle(e.target.value)}
                    autoFocus
                    data-testid="new-whiteboard-title-input"
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
                    data-testid="confirm-create-whiteboard-btn"
                  >
                    {creating && (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    )}
                    Create & Open Whiteboard
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
            placeholder="Filter whiteboards by title, project, or workspace..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="whiteboards-search-input"
          />
        </div>
      </div>

      {filteredWhiteboards.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-2">
          <Layout className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="text-sm font-semibold">No whiteboards found</div>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {searchQuery
              ? "No whiteboards match your filter criteria."
              : "Create your first collaborative visual whiteboard in your workspace to start drawing."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredWhiteboards.map((board) => (
            <Link
              key={board.id}
              href={`/app/whiteboards/${board.id}`}
              className="group"
              data-testid={`whiteboard-card-${board.id}`}
            >
              <Card className="h-full border bg-card hover:border-primary/40 hover:shadow-md transition overflow-hidden">
                {/* Visual Canvas Preview Thumbnail */}
                <div className="h-32 bg-muted/30 border-b flex items-center justify-center relative p-4 group-hover:bg-muted/50 transition">
                  <div
                    className="absolute inset-0 opacity-30 dark:opacity-15"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle, currentColor 1px, transparent 1px)",
                      backgroundSize: "16px 16px",
                    }}
                  />
                  <div className="relative z-10 flex flex-col items-center gap-2 text-muted-foreground">
                    <PenTool className="h-6 w-6 stroke-1 text-primary/60" />
                    <span className="text-[10px] font-mono">
                      Excalidraw Canvas
                    </span>
                  </div>
                  <div className="absolute top-2 right-2">
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 px-1.5 bg-background/80 font-mono"
                    >
                      {board.liveblocksRoomId}
                    </Badge>
                  </div>
                </div>

                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-5 px-1.5"
                      >
                        <PenTool className="h-3 w-3 mr-1 text-primary" />
                        Whiteboard
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] h-5 px-1.5"
                      >
                        {board.workspaceName}
                      </Badge>
                    </div>
                  </div>
                  <CardTitle className="text-sm font-semibold group-hover:text-primary transition line-clamp-1">
                    {board.title}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground flex items-center gap-1">
                    {board.projectName ? (
                      <>
                        <FolderKanban className="h-3 w-3" />
                        <span>{board.projectName}</span>
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
                      style={{ backgroundColor: board.authorColor }}
                    >
                      {getInitials(board.authorName)}
                    </div>
                    <span className="truncate max-w-[120px]">
                      {board.authorName}
                    </span>
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
