"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import Link from "next/link";
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
  useStatus,
  useSelf,
  useOthers,
  useErrorListener,
} from "@liveblocks/react";
import {
  useLiveblocksExtension,
  useIsEditorReady,
  FloatingToolbar,
} from "@liveblocks/react-tiptap";
import { useEditor, EditorContent } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import {
  ArrowLeft,
  Share2,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  FileCode,
  Quote,
  List,
  ListOrdered,
  CheckSquare,
  Heading1,
  Heading2,
  Heading3,
  Table as TableIcon,
  Link as LinkIcon,
  Unlink,
  Minus,
  Undo2,
  Redo2,
  MessageSquare,
  ListTree,
  Lock,
  Check,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Slash,
  Plus,
  Trash2,
  Copy,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  createDocumentEditorExtensions,
  buildDefaultDocumentContent,
  extractHeadingsFromJson,
  filterSlashCommands,
  normalizeSafeLinkUrl,
  type DocumentHeadingItem,
  type SlashCommandDefinition,
} from "./editor-extensions";
import { ArtifactDiscussionPanel } from "@/components/comments/artifact-discussion-panel";

export interface CollaborativeDocumentProps {
  documentId: string;
  workspaceId: string;
  workspaceName: string;
  projectName?: string | null;
  initialTitle: string;
  liveblocksRoomId: string;
  effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  authorName: string;
  updatedAtIso: string;
  initialSnapshot?: JSONContent | null;
  liveblocksConfigured: boolean;
  isDemoMode?: boolean;
  currentUser?: {
    id: string;
    name: string;
    email: string;
    color: string;
  } | null;
}

interface WorkspaceMemberItem {
  id: string;
  userId: string;
  role: string;
  user: {
    id: string;
    name: string;
    email: string;
    color: string;
  };
}

interface ArtifactPermissionItem {
  id: string;
  userId: string;
  role: "EDITOR" | "VIEWER" | "NONE";
}

function getInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}

export function DocumentEditorSkeleton({
  title,
  roomLabel,
}: {
  title: string;
  roomLabel: string;
}) {
  return (
    <div
      className="flex flex-col h-full bg-background"
      data-testid="document-loading-skeleton"
    >
      <div className="flex items-center justify-between px-6 py-2.5 border-b bg-card/50 text-xs">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Docs</span>
          </span>
          <Separator orientation="vertical" className="h-4" />
          <Badge variant="outline" className="text-[10px] gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Room: {roomLabel}</span>
          </Badge>
        </div>
      </div>
      <div className="flex-1 p-6 sm:p-12 max-w-[820px] mx-auto w-full space-y-6">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
          {title}
        </h1>
        <div className="space-y-3 animate-pulse">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-5/6 rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

export function CollaborativeDocumentView(props: CollaborativeDocumentProps) {
  if (props.isDemoMode) {
    return <StandaloneDocumentEditor {...props} />;
  }

  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id={props.liveblocksRoomId}
        initialPresence={{ cursor: null }}
      >
        <ClientSideSuspense
          fallback={
            <DocumentEditorSkeleton
              title={props.initialTitle}
              roomLabel={props.liveblocksRoomId}
            />
          }
        >
          <RoomBackedDocumentEditor {...props} />
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}

function RoomBackedDocumentEditor(props: CollaborativeDocumentProps) {
  const roomStatus = useStatus();
  const isEditorReady = useIsEditorReady();
  const self = useSelf();
  const others = useOthers();
  const [roomError, setRoomError] = useState<string | null>(null);

  useErrorListener((err) => {
    setRoomError(err.message || "Collaboration room connection error");
  });

  const initialContent = useMemo(
    () =>
      props.initialSnapshot ?? buildDefaultDocumentContent(props.initialTitle),
    [props.initialSnapshot, props.initialTitle]
  );

  const liveblocksExtension = useLiveblocksExtension({
    comments: false,
    mentions: false,
    initialContent,
  });

  const remoteCollaborators = useMemo(() => {
    return others.map((other) => {
      const info = (other.info ?? {}) as {
        name?: string;
        email?: string;
        color?: string;
        role?: string;
      };
      return {
        connectionId: other.connectionId,
        id: other.id ?? `conn-${other.connectionId}`,
        name: info.name || info.email || "Collaborator",
        color: info.color || "#10B981",
        role: info.role || "EDITOR",
      };
    });
  }, [others]);

  const selfCollaborator = useMemo(() => {
    if (self?.info) {
      const info = self.info as {
        name?: string;
        email?: string;
        color?: string;
      };
      return {
        id: self.id ?? props.currentUser?.id ?? "self",
        name: info.name || props.currentUser?.name || "You",
        color: info.color || props.currentUser?.color || "#6366F1",
      };
    }
    if (props.currentUser) {
      return {
        id: props.currentUser.id,
        name: props.currentUser.name,
        color: props.currentUser.color || "#6366F1",
      };
    }
    return null;
  }, [self, props.currentUser]);

  return (
    <RichTextDocumentWorkspace
      {...props}
      liveblocksExtension={liveblocksExtension}
      roomStatus={roomStatus}
      isEditorReady={isEditorReady}
      roomError={roomError}
      onClearRoomError={() => setRoomError(null)}
      selfCollaborator={selfCollaborator}
      remoteCollaborators={remoteCollaborators}
      initialContent={initialContent}
    />
  );
}

function StandaloneDocumentEditor(props: CollaborativeDocumentProps) {
  const initialContent = useMemo(
    () =>
      props.initialSnapshot ?? buildDefaultDocumentContent(props.initialTitle),
    [props.initialSnapshot, props.initialTitle]
  );

  return (
    <RichTextDocumentWorkspace
      {...props}
      liveblocksExtension={null}
      roomStatus="connected"
      isEditorReady={true}
      roomError={null}
      onClearRoomError={() => {}}
      selfCollaborator={
        props.currentUser
          ? {
              id: props.currentUser.id,
              name: props.currentUser.name,
              color: props.currentUser.color || "#6366F1",
            }
          : { id: "demo-self", name: "Sunil Kumar", color: "#6366F1" }
      }
      remoteCollaborators={[
        {
          connectionId: 1,
          id: "demo-1",
          name: "Alex Chen",
          color: "#10B981",
          role: "EDITOR",
        },
        {
          connectionId: 2,
          id: "demo-2",
          name: "Jane Doe",
          color: "#3B82F6",
          role: "EDITOR",
        },
      ]}
      initialContent={initialContent}
    />
  );
}

interface RichTextDocumentWorkspaceProps extends CollaborativeDocumentProps {
  liveblocksExtension: ReturnType<typeof useLiveblocksExtension> | null;
  roomStatus:
    | "initial"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected";
  isEditorReady: boolean;
  roomError: string | null;
  onClearRoomError: () => void;
  selfCollaborator: { id: string; name: string; color: string } | null;
  remoteCollaborators: Array<{
    connectionId: number;
    id: string;
    name: string;
    color: string;
    role: string;
  }>;
  initialContent: JSONContent;
}

function RichTextDocumentWorkspace({
  documentId,
  workspaceId,
  workspaceName,
  projectName,
  initialTitle,
  liveblocksRoomId,
  effectiveRole,
  authorName,
  updatedAtIso,
  liveblocksConfigured,
  isDemoMode = false,
  liveblocksExtension,
  roomStatus,
  isEditorReady,
  roomError,
  onClearRoomError,
  selfCollaborator,
  remoteCollaborators,
  initialContent,
  currentUser,
}: RichTextDocumentWorkspaceProps) {
  const canEdit = effectiveRole !== "VIEWER";
  const canAdmin = effectiveRole === "OWNER" || effectiveRole === "ADMIN";

  const [title, setTitle] = useState(initialTitle);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [lastUpdatedText, setLastUpdatedText] = useState<string>(() => {
    try {
      return new Date(updatedAtIso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "Just now";
    }
  });

  // Outline / Table of contents state
  const [headings, setHeadings] = useState<DocumentHeadingItem[]>(() =>
    extractHeadingsFromJson(initialContent)
  );
  const [showOutline, setShowOutline] = useState(true);
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("thread")) {
        setShowCommentsDrawer(true);
      }
    }
  }, []);

  // Link popover state
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  // Slash command menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const slashRangeRef = useRef<{ from: number; to: number } | null>(null);

  // Share / Permissions dialog state
  const [shareOpen, setShareOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<
    WorkspaceMemberItem[]
  >([]);
  const [artifactPermissions, setArtifactPermissions] = useState<
    ArtifactPermissionItem[]
  >([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);

  const hasSeededFallbackRef = useRef(false);
  const saveSnapshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const extensions = useMemo(
    () =>
      createDocumentEditorExtensions({
        liveblocksExtension,
        placeholder: canEdit
          ? "Write technical specifications, or type '/' for commands..."
          : "Read-only document view",
      }),
    [liveblocksExtension, canEdit]
  );

  const persistSnapshotToDatabase = useCallback(
    async (docJson: JSONContent) => {
      if (isDemoMode || !canEdit) return;
      try {
        setSaveState("saving");
        const res = await fetch(`/api/artifacts/${documentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentSnapshot: docJson }),
        });
        if (res.ok) {
          setSaveState("saved");
          setLastUpdatedText(
            new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          );
        } else {
          setSaveState("error");
        }
      } catch {
        setSaveState("error");
      }
    },
    [documentId, isDemoMode, canEdit]
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions,
    content: liveblocksExtension ? undefined : initialContent,
    editorProps: {
      attributes: {
        class: "tiptap ProseMirror focus:outline-none min-h-[460px]",
        "data-testid": "tiptap-editor-canvas",
        "aria-readonly": canEdit ? "false" : "true",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const json = currentEditor.getJSON();
      setHeadings(extractHeadingsFromJson(json));

      // Detect slash command trigger '/' at start of block or after space
      if (canEdit) {
        const { state } = currentEditor;
        const { selection } = state;
        const { $from, empty } = selection;

        if (empty && $from.parent.isTextblock) {
          const textBefore = $from.parent.textBetween(
            0,
            $from.parentOffset,
            "\0",
            "\0"
          );
          const slashMatch = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(textBefore);
          if (slashMatch) {
            const matchQuery = slashMatch[1] ?? "";
            const fromPos = $from.pos - matchQuery.length - 1;
            slashRangeRef.current = { from: fromPos, to: $from.pos };
            setSlashQuery(matchQuery);
            setSlashSelectedIndex(0);
            setSlashMenuOpen(true);
          } else {
            setSlashMenuOpen(false);
            slashRangeRef.current = null;
          }
        } else {
          setSlashMenuOpen(false);
          slashRangeRef.current = null;
        }

        // Debounced PostgreSQL snapshot persistence
        if (!isDemoMode) {
          if (saveSnapshotTimeoutRef.current) {
            clearTimeout(saveSnapshotTimeoutRef.current);
          }
          saveSnapshotTimeoutRef.current = setTimeout(() => {
            void persistSnapshotToDatabase(json);
          }, 900);
        }
      }
    },
  });

  // Ensure editor editable state stays synchronized with effectiveRole
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== canEdit) {
      editor.setEditable(canEdit);
    }
  }, [editor, canEdit]);

  // Seed initial content when Liveblocks cloud room is not yet connected (e.g. placeholder secret key)
  // or when the room finishes initializing with empty content.
  useEffect(() => {
    if (!editor || hasSeededFallbackRef.current) return;

    if (!liveblocksConfigured || roomError || isEditorReady) {
      const currentText = editor.getText().trim();
      const currentJson = editor.getJSON();
      const isDocEmpty =
        currentText.length === 0 &&
        (!currentJson.content ||
          currentJson.content.length <= 1);

      if (isDocEmpty && initialContent) {
        hasSeededFallbackRef.current = true;
        editor.commands.setContent(initialContent, { emitUpdate: false });
        setHeadings(extractHeadingsFromJson(initialContent));
      }
    }
  }, [
    editor,
    liveblocksConfigured,
    roomError,
    isEditorReady,
    initialContent,
  ]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (saveSnapshotTimeoutRef.current) {
        clearTimeout(saveSnapshotTimeoutRef.current);
      }
    };
  }, []);

  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashQuery),
    [slashQuery]
  );

  const executeSlashCommand = useCallback(
    (cmd: SlashCommandDefinition) => {
      if (!editor || !canEdit) return;

      const chain = editor.chain().focus();
      if (slashRangeRef.current) {
        chain.deleteRange(slashRangeRef.current);
      }

      switch (cmd.id) {
        case "h1":
          chain.setHeading({ level: 1 }).run();
          break;
        case "h2":
          chain.setHeading({ level: 2 }).run();
          break;
        case "h3":
          chain.setHeading({ level: 3 }).run();
          break;
        case "bulletList":
          chain.toggleBulletList().run();
          break;
        case "orderedList":
          chain.toggleOrderedList().run();
          break;
        case "taskList":
          chain.toggleTaskList().run();
          break;
        case "blockquote":
          chain.toggleBlockquote().run();
          break;
        case "codeBlock":
          chain.toggleCodeBlock().run();
          break;
        case "table":
          chain
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
          break;
        case "horizontalRule":
          chain.setHorizontalRule().run();
          break;
      }

      setSlashMenuOpen(false);
      slashRangeRef.current = null;
    },
    [editor, canEdit]
  );

  // Keyboard navigation for Slash Command Menu
  useEffect(() => {
    if (!slashMenuOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((prev) =>
          filteredSlashCommands.length > 0
            ? (prev + 1) % filteredSlashCommands.length
            : 0
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((prev) =>
          filteredSlashCommands.length > 0
            ? (prev - 1 + filteredSlashCommands.length) %
              filteredSlashCommands.length
            : 0
        );
      } else if (e.key === "Enter" && filteredSlashCommands[slashSelectedIndex]) {
        e.preventDefault();
        executeSlashCommand(filteredSlashCommands[slashSelectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    slashMenuOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    executeSlashCommand,
  ]);

  const handleSaveTitle = useCallback(
    async (nextTitle: string) => {
      const trimmed = nextTitle.trim() || "Untitled Document";
      setTitle(trimmed);
      setIsEditingTitle(false);

      if (isDemoMode || !canEdit || trimmed === initialTitle) {
        return;
      }

      try {
        setSaveState("saving");
        const res = await fetch(`/api/artifacts/${documentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        if (res.ok) {
          setSaveState("saved");
          setLastUpdatedText(
            new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          );
        } else {
          setSaveState("error");
        }
      } catch {
        setSaveState("error");
      }
    },
    [documentId, isDemoMode, canEdit, initialTitle]
  );

  const handleApplyLink = useCallback(() => {
    if (!editor || !canEdit) return;
    setLinkError(null);

    if (!linkInput.trim()) {
      editor.chain().focus().unsetLink().run();
      setLinkPopoverOpen(false);
      return;
    }

    const safeUrl = normalizeSafeLinkUrl(linkInput);
    if (!safeUrl) {
      setLinkError(
        "Please enter a valid http://, https://, or mailto: URL."
      );
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: safeUrl })
      .run();
    setLinkInput("");
    setLinkPopoverOpen(false);
  }, [editor, canEdit, linkInput]);

  const loadSharePermissions = useCallback(async () => {
    if (isDemoMode || !workspaceId) return;
    setLoadingPermissions(true);
    try {
      const [membersRes, permsRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/members`),
        fetch(`/api/artifacts/${documentId}/permissions`),
      ]);
      if (membersRes.ok) {
        const membersJson = await membersRes.json();
        setWorkspaceMembers(membersJson.data ?? []);
      }
      if (permsRes.ok) {
        const permsJson = await permsRes.json();
        setArtifactPermissions(permsJson.data ?? []);
      }
    } finally {
      setLoadingPermissions(false);
    }
  }, [isDemoMode, workspaceId, documentId]);

  const handleOverrideChange = async (
    targetUserId: string,
    role: "EDITOR" | "VIEWER" | "NONE" | "INHERIT"
  ) => {
    if (!canAdmin || isDemoMode) return;
    const res = await fetch(`/api/artifacts/${documentId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: targetUserId, role }),
    });
    if (res.ok) {
      await loadSharePermissions();
    }
  };

  // Resolve connection status display
  const connectionBadge = useMemo(() => {
    if (isDemoMode) {
      return {
        label: "Demo Preview",
        dotClass: "bg-emerald-500",
        badgeClass:
          "text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
      };
    }
    if (!liveblocksConfigured) {
      return {
        label: "PostgreSQL Sync (Liveblocks Key Required)",
        dotClass: "bg-amber-500",
        badgeClass:
          "text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10",
      };
    }
    if (roomError) {
      return {
        label: "Room Auth / Connection Error",
        dotClass: "bg-destructive",
        badgeClass:
          "text-destructive border-destructive/30 bg-destructive/10",
      };
    }
    switch (roomStatus) {
      case "connected":
        return {
          label: isEditorReady ? "Connected & Synced" : "Synchronizing Yjs...",
          dotClass: "bg-emerald-500 animate-pulse",
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
  }, [
    isDemoMode,
    liveblocksConfigured,
    roomError,
    roomStatus,
    isEditorReady,
  ]);

  const isInsideTable = editor?.isActive("table") ?? false;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top Document Context & Presence Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-2.5 border-b bg-card/50 text-xs">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            href="/app/documents"
            className="text-muted-foreground hover:text-foreground transition flex items-center gap-1 font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Docs</span>
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

          <Badge
            variant={effectiveRole === "VIEWER" ? "outline" : "secondary"}
            className="text-[10px] gap-1"
            data-testid="document-effective-role"
          >
            {effectiveRole === "VIEWER" && <Lock className="h-2.5 w-2.5" />}
            <span>{effectiveRole}</span>
          </Badge>

          {/* Persistence indicator */}
          <span
            className="text-[11px] text-muted-foreground flex items-center gap-1"
            data-testid="document-save-status"
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
                <span>Saved {lastUpdatedText}</span>
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
          {/* Online Collaborator Avatars */}
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
              <Tooltip key={collab.connectionId}>
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
                  {collab.name} (Live in room)
                </TooltipContent>
              </Tooltip>
            ))}
          </div>

          {/* Toggle Outline Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={showOutline ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setShowOutline((v) => !v)}
                data-testid="toggle-outline-button"
              >
                <ListTree className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Outline</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Toggle Document Outline
            </TooltipContent>
          </Tooltip>

          {/* Comments Entry Point */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={showCommentsDrawer ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setShowCommentsDrawer((v) => !v)}
                data-testid="toggle-comments-button"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Comments</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Contextual Discussions
            </TooltipContent>
          </Tooltip>

          {/* Share & Permissions Dialog */}
          <Dialog
            open={shareOpen}
            onOpenChange={(open) => {
              setShareOpen(open);
              if (open) {
                void loadSharePermissions();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                data-testid="share-document-button"
              >
                <Share2 className="h-3 w-3" />
                <span>Share</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4 text-brand-indigo" />
                  <span>Document Access & Permissions</span>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Manage per-artifact role overrides for{" "}
                  <strong className="text-foreground">{title}</strong>. Room
                  tokens issued by <code>/api/liveblocks-auth</code> enforce
                  these permissions immediately.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={
                      typeof window !== "undefined"
                        ? window.location.href
                        : `/app/documents/${documentId}`
                    }
                    className="h-8 text-xs font-mono"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 text-xs gap-1.5 shrink-0"
                    onClick={() => {
                      if (typeof navigator !== "undefined" && navigator.clipboard) {
                        void navigator.clipboard.writeText(window.location.href);
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
                    Workspace Members & Artifact Overrides
                  </div>
                  {loadingPermissions ? (
                    <div className="text-xs text-muted-foreground py-3 flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Loading member permissions...</span>
                    </div>
                  ) : workspaceMembers.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2">
                      Workspace members inherit their default workspace role unless overridden.
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

      {/* Rich-Text Formatting Toolbar */}
      <div
        className="flex items-center gap-0.5 px-6 py-1.5 border-b bg-muted/20 overflow-x-auto text-muted-foreground"
        role="toolbar"
        aria-label="Document formatting toolbar"
        data-testid="document-formatting-toolbar"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).tagName !== "INPUT") {
            e.preventDefault();
          }
        }}
      >
        {/* Collaborative Undo / Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().undo().run()}
              aria-label="Undo"
              data-testid="toolbar-undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Collaborative Undo (Ctrl+Z)
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().redo().run()}
              aria-label="Redo"
              data-testid="toolbar-redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Collaborative Redo (Ctrl+Y)
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-4 mx-1" />

        {/* Headings H1 - H3 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={
                editor?.isActive("heading", { level: 1 }) ? "secondary" : "ghost"
              }
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() =>
                editor?.chain().focus().toggleHeading({ level: 1 }).run()
              }
              aria-label="Heading 1"
              data-testid="toolbar-h1"
            >
              <Heading1 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Heading 1
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={
                editor?.isActive("heading", { level: 2 }) ? "secondary" : "ghost"
              }
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() =>
                editor?.chain().focus().toggleHeading({ level: 2 }).run()
              }
              aria-label="Heading 2"
              data-testid="toolbar-h2"
            >
              <Heading2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Heading 2
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={
                editor?.isActive("heading", { level: 3 }) ? "secondary" : "ghost"
              }
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() =>
                editor?.chain().focus().toggleHeading({ level: 3 }).run()
              }
              aria-label="Heading 3"
              data-testid="toolbar-h3"
            >
              <Heading3 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Heading 3
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-4 mx-1" />

        {/* Inline Formatting: Bold, Italic, Underline, Strike, Code */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("bold") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleBold().run()}
              aria-label="Bold"
              data-testid="toolbar-bold"
            >
              <Bold className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Bold (Ctrl+B)
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("italic") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              aria-label="Italic"
              data-testid="toolbar-italic"
            >
              <Italic className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Italic (Ctrl+I)
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("underline") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
              aria-label="Underline"
              data-testid="toolbar-underline"
            >
              <UnderlineIcon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Underline (Ctrl+U)
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("strike") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              aria-label="Strikethrough"
              data-testid="toolbar-strike"
            >
              <Strikethrough className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Strikethrough
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("code") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleCode().run()}
              aria-label="Inline Code"
              data-testid="toolbar-code"
            >
              <Code className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Inline Code (Ctrl+E)
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-4 mx-1" />

        {/* Lists & Blocks */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("bulletList") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              aria-label="Bullet List"
              data-testid="toolbar-bullet-list"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Bullet List
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("orderedList") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              aria-label="Numbered List"
              data-testid="toolbar-ordered-list"
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Numbered List
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("taskList") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleTaskList().run()}
              aria-label="Task List"
              data-testid="toolbar-task-list"
            >
              <CheckSquare className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Task Checklist
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("blockquote") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              aria-label="Blockquote"
              data-testid="toolbar-blockquote"
            >
              <Quote className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Blockquote
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={editor?.isActive("codeBlock") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
              aria-label="Code Block"
              data-testid="toolbar-code-block"
            >
              <FileCode className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Code Block
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() => editor?.chain().focus().setHorizontalRule().run()}
              aria-label="Horizontal Rule"
              data-testid="toolbar-hr"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Horizontal Divider
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-4 mx-1" />

        {/* Safe Link Popover */}
        <Popover
          open={linkPopoverOpen}
          onOpenChange={(open) => {
            setLinkPopoverOpen(open);
            setLinkError(null);
            if (open && editor) {
              const existingHref = editor.getAttributes("link").href as
                | string
                | undefined;
              setLinkInput(existingHref ?? "");
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant={editor?.isActive("link") ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              aria-label="Insert Link"
              data-testid="toolbar-link"
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3 space-y-2" align="start">
            <div className="text-xs font-semibold">Insert or Edit Safe Link</div>
            <Input
              placeholder="https://example.com"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleApplyLink();
                }
              }}
              className="h-8 text-xs"
              data-testid="link-url-input"
            />
            {linkError && (
              <p className="text-[11px] text-destructive">{linkError}</p>
            )}
            <div className="flex items-center justify-between pt-1">
              {editor?.isActive("link") ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive gap-1"
                  onClick={() => {
                    editor?.chain().focus().unsetLink().run();
                    setLinkPopoverOpen(false);
                  }}
                >
                  <Unlink className="h-3 w-3" />
                  <span>Remove</span>
                </Button>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  http, https, mailto only
                </span>
              )}
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleApplyLink}
                data-testid="apply-link-button"
              >
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Table Insertion & Contextual Table Operations */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isInsideTable ? "secondary" : "ghost"}
              size="icon-sm"
              className="h-7 w-7"
              disabled={!canEdit || !editor}
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
              aria-label="Insert Table"
              data-testid="toolbar-table"
            >
              <TableIcon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Insert 3x3 Table
          </TooltipContent>
        </Tooltip>

        {isInsideTable && canEdit && (
          <div className="flex items-center gap-1 ml-1 pl-1 border-l">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] gap-1"
              onClick={() => editor?.chain().focus().addRowAfter().run()}
              data-testid="table-add-row"
            >
              <Plus className="h-2.5 w-2.5" />
              <span>Row</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] gap-1"
              onClick={() => editor?.chain().focus().addColumnAfter().run()}
              data-testid="table-add-col"
            >
              <Plus className="h-2.5 w-2.5" />
              <span>Col</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] text-destructive gap-1"
              onClick={() => editor?.chain().focus().deleteTable().run()}
              data-testid="table-delete"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </Button>
          </div>
        )}

        <Separator orientation="vertical" className="h-4 mx-1" />

        {/* Quick Slash Menu Trigger */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={slashMenuOpen ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              disabled={!canEdit || !editor}
              onClick={() => {
                setSlashQuery("");
                setSlashSelectedIndex(0);
                slashRangeRef.current = null;
                setSlashMenuOpen((open) => !open);
              }}
              data-testid="toolbar-slash-trigger"
            >
              <Slash className="h-3 w-3" />
              <span className="hidden md:inline">Insert</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Open Block Insert Menu (or type &apos;/&apos;)
          </TooltipContent>
        </Tooltip>

        <span className="ml-auto text-[11px] text-muted-foreground font-mono hidden lg:inline">
          {canEdit
            ? "Yjs CRDT • Type '/' for blocks"
            : "Read-Only Viewer Mode"}
        </span>
      </div>

      {/* Contextual Status Banners */}
      {!canEdit && (
        <div
          className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2 flex items-center justify-between text-xs text-amber-700 dark:text-amber-300"
          data-testid="viewer-readonly-banner"
        >
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>Read-Only Access ({effectiveRole}):</strong> You have
              viewer permissions on this document. Editing and formatting
              controls are disabled.
            </span>
          </div>
        </div>
      )}

      {!isDemoMode && (!liveblocksConfigured || roomError) && (
        <div
          className="bg-brand-indigo/5 border-b border-brand-indigo/20 px-6 py-2 flex items-center justify-between gap-4 text-xs text-foreground"
          data-testid="liveblocks-credential-banner"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span>
              {!liveblocksConfigured ? (
                <>
                  <strong>Liveblocks Secret Key Not Configured:</strong>{" "}
                  <code>LIVEBLOCKS_SECRET_KEY</code> is currently set to a
                  placeholder. Rich-text editing and PostgreSQL persistence are
                  active locally; configure a valid <code>sk_...</code> secret
                  key to enable live WebSocket room sync.
                </>
              ) : (
                <>
                  <strong>Room Connection Notice:</strong> {roomError}
                </>
              )}
            </span>
          </div>
          {roomError && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px] gap-1 shrink-0"
              onClick={onClearRoomError}
            >
              <RefreshCw className="h-3 w-3" />
              <span>Dismiss</span>
            </Button>
          )}
        </div>
      )}

      {/* Main Workspace Area: Document Surface + Optional Outline / Comments Rail */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Scrollable Document Writing Surface */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-12">
          <div className="max-w-[800px] mx-auto space-y-6">
            {/* Document Title (Inline Editable for Editors, H1 preserved for accessibility & tests) */}
            <div className="space-y-2">
              {canEdit && isEditingTitle ? (
                <div className="flex items-center gap-2">
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
                    className="text-2xl sm:text-3xl font-extrabold tracking-tight h-12 px-3"
                    data-testid="document-title-input"
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleSaveTitle(title)}
                    data-testid="document-title-save"
                  >
                    Save
                  </Button>
                </div>
              ) : (
                <h1
                  className={`text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground outline-none rounded-md transition ${
                    canEdit
                      ? "cursor-text hover:bg-muted/40 px-1.5 -mx-1.5 py-0.5"
                      : ""
                  }`}
                  onClick={() => {
                    if (canEdit) {
                      setIsEditingTitle(true);
                    }
                  }}
                  title={
                    canEdit ? "Click to rename document title" : undefined
                  }
                  data-testid="document-title-heading"
                >
                  {title}
                </h1>
              )}

              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
                <span>By {authorName}</span>
                <span>•</span>
                <span>Last synced {lastUpdatedText}</span>
                <span>•</span>
                <span>
                  {remoteCollaborators.length + (selfCollaborator ? 1 : 0)}{" "}
                  active in session
                </span>
              </div>
            </div>

            <Separator />

            {/* Slash Command Popover Menu */}
            {slashMenuOpen && canEdit && (
              <div
                className="rounded-lg border bg-popover text-popover-foreground shadow-lg p-2 space-y-1 max-w-sm z-30"
                role="listbox"
                aria-label="Slash commands"
                data-testid="slash-command-menu"
              >
                <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                  <span>Insert Block {slashQuery ? `("/${slashQuery}")` : ""}</span>
                  <span className="font-mono text-[10px]">↑↓ Enter Esc</span>
                </div>
                {filteredSlashCommands.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    No matching block commands
                  </div>
                ) : (
                  filteredSlashCommands.map((cmd, idx) => (
                    <button
                      key={cmd.id}
                      type="button"
                      role="option"
                      aria-selected={idx === slashSelectedIndex}
                      onClick={() => executeSlashCommand(cmd)}
                      className={`w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded-md text-xs transition ${
                        idx === slashSelectedIndex
                          ? "bg-accent text-accent-foreground font-medium"
                          : "hover:bg-muted/60"
                      }`}
                      data-testid={`slash-item-${cmd.id}`}
                    >
                      <div>
                        <div className="font-medium">{cmd.title}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {cmd.description}
                        </div>
                      </div>
                      <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {cmd.shortcut}
                      </kbd>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Tiptap + Yjs + Liveblocks Rich-Text Editor Surface */}
            <div className="syncspace-editor relative">
              {editor && canEdit && liveblocksExtension && (
                <FloatingToolbar editor={editor} />
              )}
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>

        {/* Right-Hand Document Outline / Table of Contents Rail */}
        {showOutline && (
          <aside
            className="w-64 border-l bg-card/30 p-4 overflow-y-auto hidden xl:flex flex-col gap-3"
            aria-label="Document Outline"
            data-testid="document-outline-panel"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Document Outline
              </span>
              <Badge variant="outline" className="text-[10px]">
                {headings.length}
              </Badge>
            </div>

            {headings.length === 0 ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Add H1, H2, or H3 headings to automatically generate a
                structured table of contents.
              </p>
            ) : (
              <nav className="space-y-1">
                {headings.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      editor?.commands.focus();
                    }}
                    className={`w-full text-left text-xs py-1 px-2 rounded hover:bg-muted/60 transition truncate block ${
                      h.level === 1
                        ? "font-semibold text-foreground"
                        : h.level === 2
                          ? "pl-4 text-foreground/90"
                          : "pl-7 text-muted-foreground"
                    }`}
                    data-testid="outline-heading-item"
                  >
                    {h.text}
                  </button>
                ))}
              </nav>
            )}
          </aside>
        )}

        {/* Artifact Discussion Panel */}
        <ArtifactDiscussionPanel
          artifactId={documentId}
          isOpen={showCommentsDrawer}
          onClose={() => setShowCommentsDrawer(false)}
          currentUser={currentUser ?? selfCollaborator}
          canComment={true}
          effectiveRole={effectiveRole}
        />
      </div>
    </div>
  );
}
