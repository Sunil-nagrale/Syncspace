"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft,
  Share2,
  Download,
  Lock,
  Check,
  Loader2,
  AlertTriangle,
  Copy,
  FileImage,
  Code,
  FileText,
  MessageSquare,
  History,
} from "lucide-react";
import { ArtifactDiscussionPanel } from "@/components/comments/artifact-discussion-panel";
import { VersionHistoryDrawer } from "@/components/versions/version-history-drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
} from "@liveblocks/react";
import { LiveMap } from "@liveblocks/client";
import type {
  AppState,
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  CollaborativeWhiteboardProps,
  WhiteboardMemberItem,
  WhiteboardPermissionItem,
} from "./types";
import { useWhiteboardSync } from "./use-whiteboard-sync";

// Client-only dynamic import of the Excalidraw inner canvas to prevent SSR window reference errors
const ExcalidrawCanvasInner = dynamic(
  () => import("./excalidraw-canvas-inner"),
  {
    ssr: false,
    loading: () => <WhiteboardCanvasSkeleton title="Loading whiteboard canvas..." />,
  }
);

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "WB";
}

function WhiteboardCanvasSkeleton({ title }: { title: string }) {
  return (
    <div
      className="flex flex-col h-full w-full bg-background items-center justify-center relative select-none"
      data-testid="whiteboard-loading-skeleton"
    >
      <div
        className="absolute inset-0 opacity-20 dark:opacity-10"
        style={{
          backgroundImage:
            "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="relative z-10 flex flex-col items-center gap-3 p-6 rounded-xl border bg-card/70 backdrop-blur-sm shadow-sm max-w-sm text-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-indigo" />
        <div className="text-sm font-semibold">{title}</div>
        <p className="text-xs text-muted-foreground">
          Initializing Excalidraw multiplayer canvas...
        </p>
      </div>
    </div>
  );
}

export function CollaborativeWhiteboardView(props: CollaborativeWhiteboardProps) {
  if (props.isDemoMode) {
    return <StandaloneWhiteboardWorkspace {...props} />;
  }

  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id={props.liveblocksRoomId}
        initialPresence={{ cursor: null, selectedElementIds: {} }}
        initialStorage={
          props.effectiveRole === "VIEWER"
            ? undefined
            : { elements: new LiveMap() }
        }
      >
        <ClientSideSuspense
          fallback={
            <WhiteboardCanvasSkeleton
              title={`Connecting to ${props.initialTitle}...`}
            />
          }
        >
          <RoomBackedWhiteboardWorkspace {...props} />
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}

function RoomBackedWhiteboardWorkspace(props: CollaborativeWhiteboardProps) {
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const {
    roomStatus,
    collaborators,
    remoteCollaborators,
    selfCollaborator,
    handleCanvasChange,
    handlePointerUpdate,
    saveState,
    lastSavedText,
    restoreScene,
  } = useWhiteboardSync(props, excalidrawAPIRef);

  return (
    <WhiteboardWorkspaceLayout
      {...props}
      excalidrawAPIRef={excalidrawAPIRef}
      roomStatus={roomStatus}
      collaborators={collaborators}
      remoteCollaborators={remoteCollaborators}
      selfCollaborator={selfCollaborator}
      onCanvasChange={handleCanvasChange}
      onPointerUpdate={handlePointerUpdate}
      onRestoreScene={restoreScene}
      saveState={saveState}
      lastSavedText={lastSavedText}
    />
  );
}

function StandaloneWhiteboardWorkspace(props: CollaborativeWhiteboardProps) {
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const [saveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSavedText = "Local Demo";

  const selfCollaborator = useMemo(
    () => ({
      id: props.currentUser?.id ?? "demo-self",
      name: props.currentUser?.name ?? "Sunil Kumar",
      color: props.currentUser?.color ?? "#6366F1",
    }),
    [props.currentUser]
  );

  const remoteCollaborators = useMemo(
    () => [
      {
        connectionId: 1,
        id: "demo-peer-1",
        name: "Alex Chen",
        color: "#10B981",
        role: "EDITOR",
      },
    ],
    []
  );

  const collaborators = useMemo(() => new Map(), []);

  return (
    <WhiteboardWorkspaceLayout
      {...props}
      excalidrawAPIRef={excalidrawAPIRef}
      roomStatus="connected"
      collaborators={collaborators}
      remoteCollaborators={remoteCollaborators}
      selfCollaborator={selfCollaborator}
      onCanvasChange={() => {}}
      onPointerUpdate={() => {}}
      onRestoreScene={(elements) => excalidrawAPIRef.current?.updateScene({ elements })}
      saveState={saveState}
      lastSavedText={lastSavedText}
    />
  );
}

interface WhiteboardWorkspaceLayoutProps extends CollaborativeWhiteboardProps {
  excalidrawAPIRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>;
  roomStatus:
    | "initial"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected";
  collaborators: Map<string, Collaborator>;
  remoteCollaborators: Array<{
    connectionId?: number;
    id: string;
    name: string;
    color: string;
    role: string;
  }>;
  selfCollaborator: { id: string; name: string; color: string } | null;
  onCanvasChange: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ) => void;
  onPointerUpdate: (payload: {
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "down" | "up";
  }) => void;
  onRestoreScene?: (elements: readonly ExcalidrawElement[]) => void;
  saveState: "idle" | "saving" | "saved" | "error";
  lastSavedText: string;
}

function WhiteboardWorkspaceLayout({
  whiteboardId,
  workspaceId,
  workspaceName,
  projectName,
  initialTitle,
  liveblocksRoomId,
  effectiveRole,
  isDemoMode = false,
  excalidrawAPIRef,
  roomStatus,
  collaborators,
  remoteCollaborators,
  selfCollaborator,
  onCanvasChange,
  onPointerUpdate,
  saveState,
  lastSavedText,
  currentUser,
  onRestoreScene,
  currentRevision: propRevision,
}: WhiteboardWorkspaceLayoutProps) {
  const canEdit = effectiveRole !== "VIEWER";
  const canAdmin = effectiveRole === "OWNER" || effectiveRole === "ADMIN";

  const [title, setTitle] = useState(initialTitle);
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  // Discussion / Comments state
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);

  // Version history state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [currentRevision, setCurrentRevision] = useState(propRevision ?? 1);

  const handleRestoreWhiteboard = useCallback(
    async (snapshotData: Record<string, unknown>, newTitle?: string) => {
      const elements = (snapshotData.elements as readonly ExcalidrawElement[]) || [];
      onRestoreScene?.(elements);

      if (newTitle && newTitle.trim()) {
        setTitle(newTitle.trim());
      }
      setCurrentRevision((prev) => prev + 1);
    },
    [onRestoreScene]
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("thread")) {
        setIsCommentsOpen(true);
      }
      (window as unknown as { __GET_SCENE_ELEMENTS__?: () => readonly ExcalidrawElement[] }).__GET_SCENE_ELEMENTS__ = () =>
        excalidrawAPIRef.current?.getSceneElementsIncludingDeleted() || [];
    }
  }, [excalidrawAPIRef]);

  // Share & Permissions modal state
  const [shareOpen, setShareOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<WhiteboardMemberItem[]>([]);
  const [artifactPermissions, setArtifactPermissions] = useState<WhiteboardPermissionItem[]>([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);

  const handleSaveTitle = useCallback(
    async (nextTitle: string) => {
      const trimmed = nextTitle.trim() || "Untitled Whiteboard";
      setTitle(trimmed);
      setIsEditingTitle(false);

      if (isDemoMode || !canEdit || trimmed === initialTitle) {
        return;
      }

      try {
        await fetch(`/api/artifacts/${whiteboardId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
      } catch {
        // Silently handled by save indicator
      }
    },
    [whiteboardId, isDemoMode, canEdit, initialTitle]
  );

  const loadPermissions = useCallback(async () => {
    if (isDemoMode) return;
    setLoadingPermissions(true);
    try {
      const [membersRes, permsRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/members`),
        fetch(`/api/artifacts/${whiteboardId}/permissions`),
      ]);

      if (membersRes.ok) {
        const data = await membersRes.json();
        setWorkspaceMembers(data.data || []);
      }
      if (permsRes.ok) {
        const data = await permsRes.json();
        setArtifactPermissions(data.data || []);
      }
    } catch {
      // Handled gracefully in UI
    } finally {
      setLoadingPermissions(false);
    }
  }, [workspaceId, whiteboardId, isDemoMode]);

  useEffect(() => {
    if (shareOpen) {
      void loadPermissions();
    }
  }, [shareOpen, loadPermissions]);

  const handleOverrideChange = useCallback(
    async (userId: string, targetRole: "EDITOR" | "VIEWER" | "NONE" | "INHERIT") => {
      if (!canAdmin) return;
      try {
        if (targetRole === "INHERIT") {
          await fetch(`/api/artifacts/${whiteboardId}/permissions?userId=${userId}`, {
            method: "DELETE",
          });
        } else {
          await fetch(`/api/artifacts/${whiteboardId}/permissions`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, role: targetRole }),
          });
        }
        await loadPermissions();
      } catch {
        // Handled gracefully
      }
    },
    [canAdmin, whiteboardId, loadPermissions]
  );

  // Connection badge formatting
  const connectionBadge = useMemo(() => {
    switch (roomStatus) {
      case "connected":
        return {
          label: "Connected & Synced",
          dotClass: "bg-emerald-500",
          badgeClass:
            "text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
        };
      case "connecting":
      case "initial":
        return {
          label: "Connecting to room...",
          dotClass: "bg-brand-indigo animate-ping",
          badgeClass:
            "text-brand-indigo border-brand-indigo/20 bg-brand-indigo/10",
        };
      case "reconnecting":
        return {
          label: "Reconnecting...",
          dotClass: "bg-amber-500 animate-ping",
          badgeClass:
            "text-amber-600 dark:text-amber-400 border-amber-500/20 bg-amber-500/10",
        };
      case "disconnected":
      default:
        return {
          label: "Offline",
          dotClass: "bg-muted-foreground",
          badgeClass: "text-muted-foreground border-border bg-muted/40",
        };
    }
  }, [roomStatus]);

  // Export handlers
  const handleExportPng = useCallback(async () => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    const { exportWhiteboardToPng } = await import("./excalidraw-canvas-inner");
    void exportWhiteboardToPng(api, title);
  }, [excalidrawAPIRef, title]);

  const handleExportSvg = useCallback(async () => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    const { exportWhiteboardToSvg } = await import("./excalidraw-canvas-inner");
    void exportWhiteboardToSvg(api, title);
  }, [excalidrawAPIRef, title]);

  const handleExportJson = useCallback(async () => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    const { exportWhiteboardToJson } = await import("./excalidraw-canvas-inner");
    exportWhiteboardToJson(api, title);
  }, [excalidrawAPIRef, title]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col h-full w-full bg-background overflow-hidden relative">
        {/* Whiteboard Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-2.5 border-b bg-card/70 backdrop-blur-sm text-xs z-20">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Link
              href="/app/whiteboards"
              className="text-muted-foreground hover:text-foreground transition flex items-center gap-1 font-medium"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Boards</span>
            </Link>

            {workspaceName && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-muted-foreground hidden sm:inline">
                  {workspaceName}
                </span>
              </>
            )}

            {projectName && (
              <>
                <span className="text-muted-foreground hidden sm:inline">/</span>
                <Badge variant="outline" className="text-[10px] hidden sm:inline-flex">
                  {projectName}
                </Badge>
              </>
            )}

            <Separator orientation="vertical" className="h-4" />

            {/* Editable Board Title */}
            {canEdit && isEditingTitle ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => void handleSaveTitle(title)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSaveTitle(title);
                    } else if (e.key === "Escape") {
                      setTitle(initialTitle);
                      setIsEditingTitle(false);
                    }
                  }}
                  autoFocus
                  className="h-7 text-xs font-semibold px-2 max-w-[220px]"
                  data-testid="whiteboard-title-input"
                />
                <Button
                  size="sm"
                  className="h-7 text-[11px] px-2"
                  onClick={() => void handleSaveTitle(title)}
                  data-testid="whiteboard-title-save"
                >
                  Save
                </Button>
              </div>
            ) : (
              <h1
                className={`font-semibold text-foreground text-sm truncate max-w-[240px] rounded transition ${
                  canEdit
                    ? "cursor-text hover:bg-muted/50 px-1 -mx-1 py-0.5"
                    : ""
                }`}
                onClick={() => {
                  if (canEdit) setIsEditingTitle(true);
                }}
                title={canEdit ? "Click to rename whiteboard title" : undefined}
                data-testid="whiteboard-title-heading"
              >
                {title}
              </h1>
            )}

            {/* Room Connection Status Badge */}
            <Badge
              variant="outline"
              className={`text-[10px] gap-1.5 ${connectionBadge.badgeClass}`}
              data-testid="room-connection-status"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${connectionBadge.dotClass}`}
              />
              <span>Room: {liveblocksRoomId}</span>
              <span className="hidden md:inline">• {connectionBadge.label}</span>
            </Badge>

            {/* Effective Role Badge */}
            <Badge
              variant={effectiveRole === "VIEWER" ? "outline" : "secondary"}
              className="text-[10px] gap-1"
              data-testid="whiteboard-effective-role"
            >
              {effectiveRole === "VIEWER" && <Lock className="h-2.5 w-2.5" />}
              <span>{effectiveRole}</span>
            </Badge>

            {/* Snapshot Persistence Indicator */}
            <span
              className="text-[11px] text-muted-foreground flex items-center gap-1"
              data-testid="whiteboard-save-status"
            >
              {saveState === "saving" && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-brand-indigo" />
                  <span>Saving...</span>
                </>
              )}
              {saveState === "saved" && (
                <>
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span>Saved {lastSavedText}</span>
                </>
              )}
              {saveState === "error" && (
                <>
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                  <span className="text-destructive">Save failed</span>
                </>
              )}
              {saveState === "idle" && (
                <span>Persisted in PostgreSQL</span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Online Collaborators Avatars */}
            <div
              className="flex items-center -space-x-1.5"
              data-testid="collaborator-avatars"
            >
              {selfCollaborator && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="h-6 w-6 rounded-full text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-background cursor-default"
                      style={{ backgroundColor: selfCollaborator.color }}
                      data-testid="collaborator-self-avatar"
                    >
                      {getInitials(selfCollaborator.name)}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {selfCollaborator.name} (You • {effectiveRole})
                  </TooltipContent>
                </Tooltip>
              )}

              {remoteCollaborators.map((collab) => (
                <Tooltip key={collab.connectionId ?? collab.id}>
                  <TooltipTrigger asChild>
                    <div
                      className="h-6 w-6 rounded-full text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-background cursor-default"
                      style={{ backgroundColor: collab.color }}
                      data-testid={`collaborator-remote-${collab.id}`}
                    >
                      {getInitials(collab.name)}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {collab.name} (Live on board)
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* Export Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  data-testid="whiteboard-export-trigger"
                >
                  <Download className="h-3 w-3" />
                  <span>Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs">
                  Export Canvas Scene
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleExportPng}
                  className="text-xs gap-2 cursor-pointer"
                  data-testid="export-png-btn"
                >
                  <FileImage className="h-3.5 w-3.5 text-blue-500" />
                  <span>Export as PNG</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleExportSvg}
                  className="text-xs gap-2 cursor-pointer"
                  data-testid="export-svg-btn"
                >
                  <Code className="h-3.5 w-3.5 text-purple-500" />
                  <span>Export as SVG</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleExportJson}
                  className="text-xs gap-2 cursor-pointer"
                  data-testid="export-json-btn"
                >
                  <FileText className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Export as JSON</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Comments Toggle Button */}
            <Button
              size="sm"
              variant={isCommentsOpen ? "secondary" : "outline"}
              className="h-7 text-xs gap-1.5"
              onClick={() => setIsCommentsOpen(!isCommentsOpen)}
              data-testid="whiteboard-comments-trigger"
            >
              <MessageSquare className="h-3 w-3" />
              <span className="hidden sm:inline">Comments</span>
              {commentCount !== null && commentCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[10px] h-4 px-1 py-0 font-normal bg-brand-indigo/15 text-brand-indigo"
                >
                  {commentCount}
                </Badge>
              )}
            </Button>

            {/* Version History Toggle Button */}
            <Button
              size="sm"
              variant={isHistoryOpen ? "secondary" : "outline"}
              className="h-7 text-xs gap-1.5"
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              data-testid="toggle-history-button"
            >
              <History className="h-3 w-3" />
              <span className="hidden sm:inline">History</span>
            </Button>

            {/* Share Dialog Button */}
            <Dialog open={shareOpen} onOpenChange={setShareOpen}>
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs gap-1.5"
                onClick={() => setShareOpen(true)}
                data-testid="whiteboard-share-trigger"
              >
                <Share2 className="h-3 w-3" />
                <span>Share</span>
              </Button>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-base font-bold">
                    Whiteboard Access & Permissions
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    Manage collaborator permissions for this Excalidraw scene.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-2">
                  <div className="flex items-center space-x-2">
                    <Input
                      readOnly
                      value={
                        typeof window !== "undefined"
                          ? window.location.href
                          : ""
                      }
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      size="sm"
                      className="h-8 text-xs shrink-0 gap-1.5"
                      onClick={() => {
                        if (typeof window !== "undefined") {
                          void navigator.clipboard.writeText(
                            window.location.href
                          );
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2000);
                        }
                      }}
                    >
                      {copiedLink ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Workspace Members & Scene Access
                    </div>
                    {loadingPermissions ? (
                      <div className="text-xs text-muted-foreground py-3 flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Loading member permissions...</span>
                      </div>
                    ) : workspaceMembers.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-2">
                        Workspace members inherit their default role on this whiteboard.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {workspaceMembers.map((member) => {
                          const override = artifactPermissions.find(
                            (p) => p.userId === member.userId
                          );
                          const currentOverrideValue =
                            override?.role ?? "INHERIT";

                          return (
                            <div
                              key={member.userId}
                              className="flex items-center justify-between gap-2 p-2 rounded-md border bg-muted/20 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-medium truncate">
                                  {member.user.name}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                  {member.user.email} • Workspace {member.role}
                                </div>
                              </div>

                              {canAdmin ? (
                                <select
                                  aria-label={`Permission for ${member.user.name}`}
                                  value={currentOverrideValue}
                                  onChange={(e) =>
                                    void handleOverrideChange(
                                      member.userId,
                                      e.target.value as
                                        | "EDITOR"
                                        | "VIEWER"
                                        | "NONE"
                                        | "INHERIT"
                                    )
                                  }
                                  className="h-7 rounded border bg-background px-2 text-xs"
                                >
                                  <option value="INHERIT">
                                    Inherit ({member.role})
                                  </option>
                                  <option value="EDITOR">Override: EDITOR</option>
                                  <option value="VIEWER">Override: VIEWER</option>
                                  <option value="NONE">
                                    Override: NONE (Revoke)
                                  </option>
                                </select>
                              ) : (
                                <Badge variant="outline" className="text-[10px]">
                                  {override
                                    ? `Override: ${override.role}`
                                    : member.role}
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Read-Only Notice Banner for Viewers */}
        {effectiveRole === "VIEWER" && (
          <div
            className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 z-10"
            data-testid="viewer-readonly-banner"
          >
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Read-Only Whiteboard View:</strong> You have viewer
                access to this scene. Drawing tools and canvas modifications are disabled.
              </span>
            </div>
          </div>
        )}

        {/* Responsive Interactive Canvas Viewport */}
        <div className="flex-1 w-full min-h-0 relative select-none bg-background">
          <ExcalidrawCanvasInner
            excalidrawAPIRef={excalidrawAPIRef}
            viewModeEnabled={!canEdit}
            collaborators={collaborators}
            onChange={onCanvasChange}
            onPointerUpdate={onPointerUpdate}
          />
        </div>

        {/* Artifact Discussion Panel */}
        <ArtifactDiscussionPanel
          artifactId={whiteboardId}
          isOpen={isCommentsOpen}
          onClose={() => setIsCommentsOpen(false)}
          currentUser={currentUser}
          canComment={true}
          effectiveRole={effectiveRole}
          onThreadCountChange={setCommentCount}
        />

        {/* Version History Drawer */}
        <VersionHistoryDrawer
          artifactId={whiteboardId}
          artifactType="WHITEBOARD"
          canEdit={canEdit}
          currentTitle={title}
          currentRevision={currentRevision}
          getCurrentSnapshot={() => ({ elements: excalidrawAPIRef.current?.getSceneElementsIncludingDeleted() || [] })}
          onRestore={handleRestoreWhiteboard}
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
        />
      </div>
    </TooltipProvider>
  );
}
