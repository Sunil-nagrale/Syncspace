"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  MessageSquare,
  CheckCircle2,
  RotateCcw,
  MoreVertical,
  Pencil,
  Trash2,
  Send,
  Smile,
  X,
  Loader2,
  AlertCircle,
  Clock,
  Pin,
  History,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  FormattedThread,
  FormattedComment,
  FormattedThreadEvent,
} from "@/services/comment.service";
import { MAX_COMMENT_LENGTH } from "@/lib/validations/comment";

const POPULAR_EMOJIS = ["👍", "❤️", "🎉", "🚀", "👀", "💡"];

interface ArtifactDiscussionPanelProps {
  artifactId: string;
  isOpen: boolean;
  onClose: () => void;
  currentUser?: {
    id: string;
    name: string;
    email?: string;
    color?: string;
    image?: string | null;
  } | null;
  canComment?: boolean;
  effectiveRole?: string;
  onThreadCountChange?: (count: number) => void;
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
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

export function ArtifactDiscussionPanel({
  artifactId,
  isOpen,
  onClose,
  currentUser,
  canComment = true,
  effectiveRole,
  onThreadCountChange,
}: ArtifactDiscussionPanelProps) {
  const [threads, setThreads] = useState<FormattedThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"open" | "resolved" | "all">("open");

  // Thread pagination state
  const [nextThreadCursor, setNextThreadCursor] = useState<string | null>(null);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [isLoadingMoreThreads, setIsLoadingMoreThreads] = useState(false);
  const [loadMoreThreadsError, setLoadMoreThreadsError] = useState<string | null>(null);

  // Reply pagination state
  const [loadingRepliesThreadId, setLoadingRepliesThreadId] = useState<string | null>(null);

  // Thread history state (keyed by threadId)
  const [threadEventsMap, setThreadEventsMap] = useState<Record<string, FormattedThreadEvent[]>>({});
  const [loadingEventsThreadId, setLoadingEventsThreadId] = useState<string | null>(null);
  const [expandedHistoryThreadIds, setExpandedHistoryThreadIds] = useState<Set<string>>(new Set());

  // New thread composer state
  const [newThreadContent, setNewThreadContent] = useState("");
  const [isSubmittingThread, setIsSubmittingThread] = useState(false);
  const [newThreadError, setNewThreadError] = useState<string | null>(null);

  // Reply composer state (keyed by threadId)
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  const [submittingReplyThreadId, setSubmittingReplyThreadId] = useState<string | null>(null);

  // Edit comment state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Delete modal state
  const [deleteModalCommentId, setDeleteModalCommentId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch threads from API (with cursor-based pagination)
  const nextThreadCursorRef = useRef<string | null>(null);
  nextThreadCursorRef.current = nextThreadCursor;

  const fetchThreads = useCallback(
    async (isReset = true) => {
      if (!artifactId) return;

      if (isReset) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMoreThreads(true);
        setLoadMoreThreadsError(null);
      }

      try {
        const cursorParam = !isReset && nextThreadCursorRef.current ? `&cursor=${encodeURIComponent(nextThreadCursorRef.current)}` : "";
        const statusParam = activeTab === "all" ? "all" : activeTab === "resolved" ? "resolved" : "open";
        const res = await fetch(`/api/artifacts/${artifactId}/comments?status=${statusParam}&limit=20${cursorParam}`);

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || "Failed to load discussions");
        }

        const json = await res.json();
        // Support dual format: data as array or data with pagination metadata
        const rawThreads: FormattedThread[] = Array.isArray(json.data)
          ? json.data
          : json.data?.threads ?? [];

        const pagination = json.pagination ?? {};
        const nextCursor = pagination.nextCursor ?? null;
        const hasMore = Boolean(pagination.hasMore);

        if (isReset) {
          setThreads(rawThreads);
        } else {
          setThreads((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const newUnique = rawThreads.filter((t) => !existingIds.has(t.id));
            return [...prev, ...newUnique];
          });
        }

        setNextThreadCursor(nextCursor);
        setHasMoreThreads(hasMore);

        const openCount = pagination.openCount ?? rawThreads.filter((t) => !t.isResolved).length;
        onThreadCountChange?.(openCount);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error fetching discussions";
        if (isReset) {
          setError(msg);
        } else {
          setLoadMoreThreadsError(msg);
        }
      } finally {
        if (isReset) {
          setIsLoading(false);
        } else {
          setIsLoadingMoreThreads(false);
        }
      }
    },
    [artifactId, activeTab, onThreadCountChange]
  );

  // Re-fetch whenever panel is opened or active tab changes
  useEffect(() => {
    if (isOpen) {
      setNextThreadCursor(null);
      void fetchThreads(true);
    }
  }, [isOpen, fetchThreads]);

  // Handle keyboard shortcuts (Escape to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !deleteModalCommentId) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, deleteModalCommentId]);

  // Filtered threads based on active tab
  const filteredThreads = useMemo(() => {
    if (activeTab === "open") return threads.filter((t) => !t.isResolved);
    if (activeTab === "resolved") return threads.filter((t) => t.isResolved);
    return threads;
  }, [threads, activeTab]);

  const openCount = useMemo(() => threads.filter((t) => !t.isResolved).length, [threads]);
  const resolvedCount = useMemo(() => threads.filter((t) => t.isResolved).length, [threads]);

  // Create new thread
  const handleCreateThread = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const content = newThreadContent.trim();
    if (!content || isSubmittingThread || !canComment) return;

    if (content.length > MAX_COMMENT_LENGTH) {
      setNewThreadError(`Comment exceeds maximum limit of ${MAX_COMMENT_LENGTH} characters.`);
      return;
    }

    setIsSubmittingThread(true);
    setNewThreadError(null);

    try {
      const res = await fetch(`/api/artifacts/${artifactId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to post comment");
      }

      const json = await res.json();
      const created: FormattedThread = json.data;

      setThreads((prev) => [created, ...prev]);
      setNewThreadContent("");
      onThreadCountChange?.(openCount + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error posting comment";
      setNewThreadError(msg);
    } finally {
      setIsSubmittingThread(false);
    }
  };

  // Create reply
  const handleCreateReply = async (threadId: string) => {
    const content = replyInputs[threadId]?.trim();
    if (!content || submittingReplyThreadId || !canComment) return;

    if (content.length > MAX_COMMENT_LENGTH) {
      alert(`Reply exceeds maximum limit of ${MAX_COMMENT_LENGTH} characters.`);
      return;
    }

    setSubmittingReplyThreadId(threadId);

    try {
      const res = await fetch(`/api/artifacts/${artifactId}/comments/threads/${threadId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to post reply");
      }

      const json = await res.json();
      const reply: FormattedComment = json.data;

      setThreads((prev) =>
        prev.map((t) => {
          if (t.id === threadId) {
            return {
              ...t,
              comments: [...t.comments, reply],
              commentCount: t.commentCount + 1,
              replyCount: t.replyCount + 1,
              updatedAt: reply.createdAt,
            };
          }
          return t;
        })
      );

      setReplyInputs((prev) => ({ ...prev, [threadId]: "" }));
    } catch (err: unknown) {
      console.error("Error creating reply:", err);
    } finally {
      setSubmittingReplyThreadId(null);
    }
  };

  // Load more replies for a thread
  const handleLoadMoreReplies = async (threadId: string) => {
    const targetThread = threads.find((t) => t.id === threadId);
    if (!targetThread || !targetThread.nextReplyCursor || loadingRepliesThreadId) return;

    setLoadingRepliesThreadId(threadId);

    try {
      const res = await fetch(
        `/api/artifacts/${artifactId}/comments/threads/${threadId}/replies?cursor=${encodeURIComponent(
          targetThread.nextReplyCursor
        )}&limit=20`
      );

      if (!res.ok) throw new Error("Failed to load more replies");

      const json = await res.json();
      const newReplies: FormattedComment[] = json.data ?? [];
      const pagination = json.pagination ?? {};

      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== threadId) return t;

          const existingReplyIds = new Set(t.comments.map((c) => c.id));
          const uniqueNewReplies = newReplies.filter((r) => !existingReplyIds.has(r.id));

          return {
            ...t,
            comments: [...t.comments, ...uniqueNewReplies],
            hasMoreReplies: Boolean(pagination.hasMore),
            nextReplyCursor: pagination.nextCursor ?? null,
          };
        })
      );
    } catch (err) {
      console.error("Error loading more replies:", err);
    } finally {
      setLoadingRepliesThreadId(null);
    }
  };

  // Toggle resolution status (resolve / reopen)
  const handleToggleResolve = async (threadId: string, currentResolved: boolean) => {
    const action = currentResolved ? "reopen" : "resolve";

    try {
      const res = await fetch(`/api/artifacts/${artifactId}/comments/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Failed to ${action} thread`);
      }

      const json = await res.json();
      const updated: FormattedThread = json.data;

      setThreads((prev) =>
        prev.map((t) => {
          if (t.id === threadId) {
            return {
              ...t,
              isResolved: updated.isResolved,
              resolvedAt: updated.resolvedAt,
              resolvedBy: updated.resolvedBy,
            };
          }
          return t;
        })
      );

      // Invalidate cached transition events and collapse drawer on state transition
      setThreadEventsMap((prev) => {
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      setExpandedHistoryThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });

      const newOpenCount = updated.isResolved ? openCount - 1 : openCount + 1;
      onThreadCountChange?.(Math.max(0, newOpenCount));
    } catch (err) {
      console.error(`Error ${action}ing thread:`, err);
    }
  };

  // Toggle view resolution history
  const handleToggleHistory = async (threadId: string) => {
    if (expandedHistoryThreadIds.has(threadId)) {
      setExpandedHistoryThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
      return;
    }

    setExpandedHistoryThreadIds((prev) => new Set(prev).add(threadId));

    if (!threadEventsMap[threadId] && !loadingEventsThreadId) {
      setLoadingEventsThreadId(threadId);
      try {
        const res = await fetch(`/api/artifacts/${artifactId}/comments/threads/${threadId}/events`);
        if (res.ok) {
          const json = await res.json();
          setThreadEventsMap((prev) => ({
            ...prev,
            [threadId]: json.data ?? [],
          }));
        }
      } catch (err) {
        console.error("Error fetching thread events:", err);
      } finally {
        setLoadingEventsThreadId(null);
      }
    }
  };

  // Start editing a comment
  const handleStartEdit = (comment: FormattedComment) => {
    setEditingCommentId(comment.id);
    setEditContent(comment.content);
  };

  // Save comment edit
  const handleSaveEdit = async (commentId: string) => {
    const trimmed = editContent.trim();
    if (!trimmed || isSubmittingEdit) return;

    if (trimmed.length > MAX_COMMENT_LENGTH) {
      alert(`Comment exceeds maximum limit of ${MAX_COMMENT_LENGTH} characters.`);
      return;
    }

    setIsSubmittingEdit(true);

    try {
      const res = await fetch(`/api/artifacts/${artifactId}/comments/items/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to update comment");
      }

      const json = await res.json();
      const updated: FormattedComment = json.data;

      setThreads((prev) =>
        prev.map((t) => ({
          ...t,
          comments: t.comments.map((c) => (c.id === commentId ? updated : c)),
        }))
      );

      setEditingCommentId(null);
      setEditContent("");
    } catch (err) {
      console.error("Error updating comment:", err);
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Confirm delete comment
  const handleConfirmDelete = async () => {
    if (!deleteModalCommentId || isDeleting) return;

    setIsDeleting(true);

    try {
      const res = await fetch(`/api/artifacts/${artifactId}/comments/items/${deleteModalCommentId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to delete comment");
      }

      const json = await res.json();
      const result = json.data as { deletedCommentId: string; deletedThreadId?: string };

      if (result.deletedThreadId) {
        // Whole thread was deleted
        setThreads((prev) => prev.filter((t) => t.id !== result.deletedThreadId));
      } else {
        // Single comment reply was deleted
        setThreads((prev) =>
          prev.map((t) => {
            const nextComments = t.comments.filter((c) => c.id !== deleteModalCommentId);
            return {
              ...t,
              comments: nextComments,
              commentCount: nextComments.length,
              replyCount: Math.max(0, nextComments.length - 1),
            };
          })
        );
      }

      setDeleteModalCommentId(null);
    } catch (err) {
      console.error("Error deleting comment:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Toggle emoji reaction
  const handleToggleReaction = async (commentId: string, emoji: string) => {
    try {
      const res = await fetch(`/api/artifacts/${artifactId}/comments/items/${commentId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });

      if (!res.ok) return;

      const json = await res.json();
      const { action } = json.data as { action: "added" | "removed" };

      // Update state locally
      setThreads((prev) =>
        prev.map((t) => ({
          ...t,
          comments: t.comments.map((c) => {
            if (c.id !== commentId) return c;

            const existingReaction = c.reactions.find((r) => r.emoji === emoji);

            if (action === "added") {
              if (existingReaction) {
                return {
                  ...c,
                  reactions: c.reactions.map((r) =>
                    r.emoji === emoji
                      ? {
                          ...r,
                          count: r.count + 1,
                          hasReacted: true,
                          users: [...r.users, { id: currentUser?.id ?? "", name: currentUser?.name ?? "You" }],
                        }
                      : r
                  ),
                };
              } else {
                return {
                  ...c,
                  reactions: [
                    ...c.reactions,
                    {
                      emoji,
                      count: 1,
                      hasReacted: true,
                      users: [{ id: currentUser?.id ?? "", name: currentUser?.name ?? "You" }],
                    },
                  ],
                };
              }
            } else {
              // Removed
              return {
                ...c,
                reactions: c.reactions
                  .map((r) =>
                    r.emoji === emoji
                      ? {
                          ...r,
                          count: Math.max(0, r.count - 1),
                          hasReacted: false,
                          users: r.users.filter((u) => u.id !== currentUser?.id),
                        }
                      : r
                  )
                  .filter((r) => r.count > 0),
              };
            }
          }),
        }))
      );
    } catch (err) {
      console.error("Error toggling reaction:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <aside
        className="fixed inset-y-0 right-0 z-40 w-full sm:w-96 md:w-[420px] bg-background border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        aria-label="Artifact discussions and comments"
        role="complementary"
        data-testid="comments-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-brand-indigo" />
            <h2 className="text-sm font-semibold tracking-tight">Discussions</h2>
            <Badge variant="secondary" className="text-xs h-5 px-1.5 font-normal">
              {openCount} active
            </Badge>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close discussion panel"
            data-testid="comments-panel-close-button"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center px-4 py-2 border-b border-border bg-background gap-1 text-xs">
          <Button
            variant={activeTab === "open" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2.5 font-medium"
            onClick={() => setActiveTab("open")}
            data-testid="comments-filter-open"
          >
            Open ({openCount})
          </Button>
          <Button
            variant={activeTab === "resolved" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2.5 font-medium"
            onClick={() => setActiveTab("resolved")}
            data-testid="comments-filter-resolved"
          >
            Resolved ({resolvedCount})
          </Button>
          <Button
            variant={activeTab === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2.5 font-medium"
            onClick={() => setActiveTab("all")}
            data-testid="comments-filter-all"
          >
            All ({threads.length})
          </Button>
        </div>

        {/* Discussion Content Scroll Area */}
        <ScrollArea className="flex-1 p-4">
          {/* New Thread Composer (at top) */}
          {canComment ? (
            <div className="mb-6 p-3 rounded-lg border border-border bg-card shadow-sm">
              <div className="text-xs font-medium text-foreground mb-1.5 flex items-center justify-between">
                <span>Start a discussion</span>
                <span className="text-[10px] text-muted-foreground">Ctrl+Enter to post</span>
              </div>
              <Textarea
                placeholder="Leave feedback or start a conversation..."
                value={newThreadContent}
                onChange={(e) => setNewThreadContent(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    void handleCreateThread();
                  }
                }}
                className="text-xs min-h-[70px] resize-none mb-2"
                data-testid="new-thread-textarea"
                maxLength={MAX_COMMENT_LENGTH}
              />
              {newThreadContent.length > 4000 && (
                <div className="text-[10px] text-muted-foreground text-right mb-1">
                  {newThreadContent.length} / {MAX_COMMENT_LENGTH}
                </div>
              )}
              {newThreadError && (
                <div className="text-[11px] text-destructive mb-2 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  <span>{newThreadError}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-muted-foreground">
                  Visible to all workspace members
                </span>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  disabled={!newThreadContent.trim() || isSubmittingThread}
                  onClick={() => void handleCreateThread()}
                  data-testid="new-thread-submit-button"
                >
                  {isSubmittingThread ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  <span>Post</span>
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-4 p-2.5 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>You have view-only access and cannot post comments.</span>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="space-y-4 py-8" data-testid="comments-loading-skeleton">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-3 rounded-lg border border-border/60 bg-muted/10 animate-pulse space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-muted" />
                    <div className="h-3 w-24 bg-muted rounded" />
                    <div className="h-3 w-12 bg-muted rounded ml-auto" />
                  </div>
                  <div className="h-3 w-3/4 bg-muted rounded" />
                  <div className="h-3 w-1/2 bg-muted rounded" />
                </div>
              ))}
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive flex flex-col items-center gap-2 text-center my-4">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs mt-1"
                onClick={() => void fetchThreads(true)}
              >
                Retry
              </Button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && filteredThreads.length === 0 && (
            <div
              className="py-12 flex flex-col items-center justify-center text-center px-4"
              data-testid="comments-empty-state"
            >
              <div className="h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center mb-3 text-muted-foreground">
                <MessageSquare className="h-5 w-5 opacity-60" />
              </div>
              <h3 className="text-xs font-semibold text-foreground mb-1">
                {activeTab === "resolved"
                  ? "No resolved discussions"
                  : activeTab === "open"
                  ? "No open discussions"
                  : "No discussions yet"}
              </h3>
              <p className="text-[11px] text-muted-foreground max-w-[220px]">
                {activeTab === "resolved"
                  ? "Discussions resolved by team members will appear here."
                  : "Leave feedback, ask questions, or collaborate on ideas right here."}
              </p>
            </div>
          )}

          {/* Thread Cards */}
          {!isLoading && !error && filteredThreads.length > 0 && (
            <div className="space-y-4" data-testid="thread-list">
              {filteredThreads.map((thread) => {
                const rootComment = thread.comments[0] ?? thread.rootComment;
                const replies = thread.comments.slice(1);
                const canResolve =
                  currentUser?.id === thread.createdBy.id ||
                  effectiveRole === "OWNER" ||
                  effectiveRole === "ADMIN" ||
                  effectiveRole === "EDITOR";

                const isHistoryExpanded = expandedHistoryThreadIds.has(thread.id);
                const events = threadEventsMap[thread.id] ?? [];

                return (
                  <div
                    key={thread.id}
                    className={`rounded-lg border transition-all ${
                      thread.isResolved
                        ? "border-border/60 bg-muted/15 opacity-85"
                        : "border-border bg-card shadow-sm"
                    }`}
                    data-testid={`thread-card-${thread.id}`}
                  >
                    {/* Thread Header */}
                    <div className="p-3 border-b border-border/50 flex items-center justify-between gap-2 bg-muted/10">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                          style={{
                            backgroundColor:
                              thread.createdBy.color || "#6366F1",
                          }}
                        >
                          {getInitials(thread.createdBy.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate text-foreground flex items-center gap-1.5">
                            <span>{thread.createdBy.name}</span>
                            {thread.anchorType && thread.anchorType !== "GENERAL" && (
                              <Badge
                                variant="outline"
                                className="text-[9px] h-3.5 px-1 font-mono text-muted-foreground flex items-center gap-0.5"
                              >
                                <Pin className="h-2 w-2" />
                                <span>{thread.anchorType.toLowerCase().replace("_", " ")}</span>
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            <span>{formatRelativeTime(thread.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Thread Resolution Toggle & History */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          title="View resolution history"
                          onClick={() => void handleToggleHistory(thread.id)}
                          data-testid={`thread-history-button-${thread.id}`}
                        >
                          <History className="h-3 w-3" />
                        </Button>

                        {canResolve && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-6 px-1.5 text-[11px] gap-1 ${
                              thread.isResolved
                                ? "text-muted-foreground hover:text-foreground"
                                : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                            }`}
                            onClick={() =>
                              void handleToggleResolve(thread.id, thread.isResolved)
                            }
                            title={thread.isResolved ? "Reopen thread" : "Resolve thread"}
                            data-testid={`thread-resolve-button-${thread.id}`}
                          >
                            {thread.isResolved ? (
                              <>
                                <RotateCcw className="h-3 w-3" />
                                <span>Reopen</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Resolve</span>
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Resolved Banner */}
                    {thread.isResolved && (
                      <div className="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                          <span>
                            Resolved by {thread.resolvedBy?.name || "a team member"}
                          </span>
                        </span>
                        {thread.resolvedAt && (
                          <span className="text-[10px] opacity-75">
                            {formatRelativeTime(thread.resolvedAt)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Expandable History Drawer */}
                    {isHistoryExpanded && (
                      <div
                        className="px-3 py-2 bg-muted/25 border-b border-border/50 text-[11px] space-y-1 animate-in fade-in-50 duration-150"
                        data-testid={`thread-history-list-${thread.id}`}
                      >
                        <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                          Audit History
                        </div>
                        {loadingEventsThreadId === thread.id ? (
                          <div className="flex items-center gap-1.5 text-muted-foreground py-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>Loading history...</span>
                          </div>
                        ) : events.length === 0 ? (
                          <div className="text-muted-foreground italic py-0.5">
                            No state transitions recorded yet.
                          </div>
                        ) : (
                          events.map((evt) => (
                            <div key={evt.id} className="flex items-center justify-between gap-2 py-0.5">
                              <span className="flex items-center gap-1 text-foreground">
                                {evt.type === "RESOLVED" ? (
                                  <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                                ) : (
                                  <RotateCcw className="h-2.5 w-2.5 text-blue-500" />
                                )}
                                <span>
                                  <strong>{evt.type === "RESOLVED" ? "Resolved" : "Reopened"}</strong> by {evt.user.name}
                                </span>
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatRelativeTime(evt.createdAt)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* Root Comment Body */}
                    {rootComment && (
                      <div className="p-3">
                        {editingCommentId === rootComment.id ? (
                          <div className="space-y-2">
                            <Textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="text-xs min-h-[60px]"
                              maxLength={MAX_COMMENT_LENGTH}
                            />
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                onClick={() => setEditingCommentId(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="h-6 text-xs px-2"
                                disabled={!editContent.trim() || isSubmittingEdit}
                                onClick={() => void handleSaveEdit(rootComment.id)}
                              >
                                {isSubmittingEdit ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  "Save"
                                )}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                              {rootComment.content}
                              {rootComment.isEdited && (
                                <span className="text-[10px] text-muted-foreground ml-1.5 italic">
                                  (edited)
                                </span>
                              )}
                            </div>

                            {/* Action toolbar & Reactions */}
                            <div className="mt-2.5 flex items-center justify-between pt-1">
                              {/* Reactions Pill Buttons */}
                              <div className="flex flex-wrap items-center gap-1">
                                {rootComment.reactions.map((r) => (
                                  <button
                                    key={r.emoji}
                                    type="button"
                                    onClick={() =>
                                      void handleToggleReaction(rootComment.id, r.emoji)
                                    }
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors ${
                                      r.hasReacted
                                        ? "bg-brand-indigo/15 border-brand-indigo/30 text-brand-indigo font-semibold"
                                        : "bg-muted/40 border-border/60 hover:bg-muted text-muted-foreground"
                                    }`}
                                    title={r.users.map((u) => u.name).join(", ")}
                                    data-testid={`comment-reaction-button-${rootComment.id}-${r.emoji}`}
                                  >
                                    <span>{r.emoji}</span>
                                    <span>{r.count}</span>
                                  </button>
                                ))}

                                {/* Reaction Picker Popover */}
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5 rounded-full text-muted-foreground hover:text-foreground p-0"
                                      title="Add reaction"
                                      data-testid={`comment-add-reaction-${rootComment.id}`}
                                    >
                                      <Smile className="h-3 w-3" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    side="top"
                                    className="w-auto p-1.5 flex items-center gap-1 shadow-md"
                                  >
                                    {POPULAR_EMOJIS.map((emoji) => (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() =>
                                          void handleToggleReaction(rootComment.id, emoji)
                                        }
                                        className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted text-base transition-transform active:scale-110"
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </PopoverContent>
                                </Popover>
                              </div>

                              {/* Author & Moderator Actions Menu */}
                              {(currentUser?.id === rootComment.author.id ||
                                effectiveRole === "OWNER" ||
                                effectiveRole === "ADMIN") && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                    >
                                      <MoreVertical className="h-3 w-3" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="text-xs">
                                    {currentUser?.id === rootComment.author.id && (
                                      <DropdownMenuItem
                                        onClick={() => handleStartEdit(rootComment)}
                                        className="gap-2 cursor-pointer"
                                        data-testid={`comment-edit-button-${rootComment.id}`}
                                      >
                                        <Pencil className="h-3 w-3" />
                                        <span>Edit comment</span>
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setDeleteModalCommentId(rootComment.id)
                                      }
                                      className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                                      data-testid={`comment-delete-button-${rootComment.id}`}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      <span>Delete thread</span>
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Replies List */}
                    {replies.length > 0 && (
                      <div className="border-t border-border/40 bg-muted/10 divide-y divide-border/30">
                        {replies.map((reply) => {
                          const isReplyAuthor =
                            currentUser?.id === reply.author.id;
                          const canDeleteReply =
                            isReplyAuthor ||
                            effectiveRole === "OWNER" ||
                            effectiveRole === "ADMIN";

                          return (
                            <div key={reply.id} className="p-3 pl-6 space-y-1.5">
                              {/* Reply Author & Time */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div
                                    className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white shrink-0"
                                    style={{
                                      backgroundColor:
                                        reply.author.color || "#6366F1",
                                    }}
                                  >
                                    {getInitials(reply.author.name)}
                                  </div>
                                  <span className="text-xs font-medium text-foreground truncate">
                                    {reply.author.name}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatRelativeTime(reply.createdAt)}
                                  </span>
                                </div>

                                {canDeleteReply && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-5 w-5 text-muted-foreground hover:text-foreground"
                                      >
                                        <MoreVertical className="h-2.5 w-2.5" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="text-xs">
                                      {isReplyAuthor && (
                                        <DropdownMenuItem
                                          onClick={() => handleStartEdit(reply)}
                                          className="gap-2 cursor-pointer"
                                          data-testid={`comment-edit-button-${reply.id}`}
                                        >
                                          <Pencil className="h-3 w-3" />
                                          <span>Edit reply</span>
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem
                                        onClick={() =>
                                          setDeleteModalCommentId(reply.id)
                                        }
                                        className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                                        data-testid={`comment-delete-button-${reply.id}`}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                        <span>Delete reply</span>
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>

                              {/* Reply Content */}
                              {editingCommentId === reply.id ? (
                                <div className="space-y-2 pt-1">
                                  <Textarea
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    className="text-xs min-h-[50px]"
                                    maxLength={MAX_COMMENT_LENGTH}
                                  />
                                  <div className="flex justify-end gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 text-xs px-2"
                                      onClick={() => setEditingCommentId(null)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-6 text-xs px-2"
                                      disabled={!editContent.trim() || isSubmittingEdit}
                                      onClick={() => void handleSaveEdit(reply.id)}
                                    >
                                      {isSubmittingEdit ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        "Save"
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                                    {reply.content}
                                    {reply.isEdited && (
                                      <span className="text-[10px] text-muted-foreground ml-1.5 italic">
                                        (edited)
                                      </span>
                                    )}
                                  </div>

                                  {/* Reply Reactions */}
                                  <div className="flex flex-wrap items-center gap-1 pt-1">
                                    {reply.reactions.map((r) => (
                                      <button
                                        key={r.emoji}
                                        type="button"
                                        onClick={() =>
                                          void handleToggleReaction(reply.id, r.emoji)
                                        }
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border transition-colors ${
                                          r.hasReacted
                                            ? "bg-brand-indigo/15 border-brand-indigo/30 text-brand-indigo font-semibold"
                                            : "bg-muted/40 border-border/60 hover:bg-muted text-muted-foreground"
                                        }`}
                                        title={r.users.map((u) => u.name).join(", ")}
                                        data-testid={`comment-reaction-button-${reply.id}-${r.emoji}`}
                                      >
                                        <span>{r.emoji}</span>
                                        <span>{r.count}</span>
                                      </button>
                                    ))}

                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-4 w-4 rounded-full text-muted-foreground hover:text-foreground p-0"
                                          title="Add reaction"
                                          data-testid={`comment-add-reaction-${reply.id}`}
                                        >
                                          <Smile className="h-2.5 w-2.5" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent
                                        side="top"
                                        className="w-auto p-1 flex items-center gap-0.5 shadow-md"
                                      >
                                        {POPULAR_EMOJIS.map((emoji) => (
                                          <button
                                            key={emoji}
                                            type="button"
                                            onClick={() =>
                                              void handleToggleReaction(reply.id, emoji)
                                            }
                                            className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-sm transition-transform active:scale-110"
                                          >
                                            {emoji}
                                          </button>
                                        ))}
                                      </PopoverContent>
                                    </Popover>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Paginated "Load more replies" button */}
                    {thread.hasMoreReplies && (
                      <div className="px-4 py-2 bg-muted/15 border-t border-border/40 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-brand-indigo hover:text-brand-indigo/80 font-medium gap-1"
                          onClick={() => void handleLoadMoreReplies(thread.id)}
                          disabled={loadingRepliesThreadId === thread.id}
                          data-testid={`load-more-replies-button-${thread.id}`}
                        >
                          {loadingRepliesThreadId === thread.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                          <span>
                            Load more replies ({thread.commentCount - thread.comments.length} remaining)
                          </span>
                        </Button>
                      </div>
                    )}

                    {/* Reply Composer */}
                    {canComment && !thread.isResolved && (
                      <div className="p-2.5 bg-muted/20 border-t border-border/50">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Write a reply... (Enter to post)"
                            value={replyInputs[thread.id] ?? ""}
                            onChange={(e) =>
                              setReplyInputs((prev) => ({
                                ...prev,
                                [thread.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleCreateReply(thread.id);
                              }
                            }}
                            className="flex-1 h-7 text-xs px-2.5 rounded-md border border-input bg-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            data-testid={`reply-textarea-${thread.id}`}
                            maxLength={MAX_COMMENT_LENGTH}
                          />
                          <Button
                            size="sm"
                            className="h-7 text-xs px-2.5 shrink-0"
                            disabled={
                              !replyInputs[thread.id]?.trim() ||
                              submittingReplyThreadId === thread.id
                            }
                            onClick={() => void handleCreateReply(thread.id)}
                            data-testid={`reply-submit-button-${thread.id}`}
                          >
                            {submittingReplyThreadId === thread.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Send className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Load More Threads Pagination Button */}
              {hasMoreThreads && (
                <div className="pt-2 pb-4 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs gap-1.5 h-8 border-dashed"
                    onClick={() => void fetchThreads(false)}
                    disabled={isLoadingMoreThreads}
                    data-testid="load-more-threads-button"
                  >
                    {isLoadingMoreThreads ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Loading more discussions...</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        <span>Load more discussions</span>
                      </>
                    )}
                  </Button>
                  {loadMoreThreadsError && (
                    <div className="text-[11px] text-destructive mt-1.5">
                      {loadMoreThreadsError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </aside>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteModalCommentId)}
        onOpenChange={(open) => !open && setDeleteModalCommentId(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Delete Comment</DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to delete this comment? If this is the first
              comment in a thread, the entire discussion thread will be deleted.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDeleteModalCommentId(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="text-xs"
              onClick={() => void handleConfirmDelete()}
              disabled={isDeleting}
              data-testid="confirm-delete-comment-button"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  <span>Deleting...</span>
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
