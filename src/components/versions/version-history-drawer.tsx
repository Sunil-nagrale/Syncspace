"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  History,
  RotateCcw,
  Eye,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  X,
  Layout,
  RefreshCw,
  Clock,
  ShieldAlert,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface VersionItem {
  id: string;
  artifactId: string;
  versionNumber: number;
  title: string;
  changeSummary?: string | null;
  source: string;
  restoredFromVersion?: number | null;
  createdById: string;
  createdAt: string;
  createdBy: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    color?: string | null;
  };
}

export interface VersionDetail extends VersionItem {
  snapshotData: Record<string, unknown>;
}

export interface VersionHistoryDrawerProps {
  artifactId: string;
  artifactType: "DOCUMENT" | "WHITEBOARD";
  canEdit: boolean;
  currentTitle: string;
  currentRevision: number;
  getCurrentSnapshot?: () => Record<string, unknown> | null | undefined;
  onRestore: (snapshotData: Record<string, unknown>, newTitle?: string) => Promise<void> | void;
  isOpen: boolean;
  onClose: () => void;
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return "Just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
}

function getSourceBadge(source: string) {
  switch (source) {
    case "MANUAL":
      return (
        <Badge
          variant="outline"
          className="text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
        >
          Manual
        </Badge>
      );
    case "RESTORED":
      return (
        <Badge
          variant="outline"
          className="text-xs bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800"
        >
          Restored
        </Badge>
      );
    case "RESTORE_RECOVERY":
      return (
        <Badge
          variant="outline"
          className="text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
        >
          Recovery
        </Badge>
      );
    case "AUTOMATIC":
    default:
      return (
        <Badge variant="secondary" className="text-xs text-muted-foreground">
          Autosave
        </Badge>
      );
  }
}

export function VersionHistoryDrawer({
  artifactId,
  artifactType,
  canEdit,
  currentTitle,
  currentRevision,
  getCurrentSnapshot,
  onRestore,
  isOpen,
  onClose,
}: VersionHistoryDrawerProps) {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Manual Checkpoint Creation State
  const [isCheckpointDialogOpen, setIsCheckpointDialogOpen] = useState<boolean>(false);
  const [checkpointTitle, setCheckpointTitle] = useState<string>("");
  const [checkpointSummary, setCheckpointSummary] = useState<string>("");
  const [isCreatingCheckpoint, setIsCreatingCheckpoint] = useState<boolean>(false);

  // Preview State
  const [previewVersion, setPreviewVersion] = useState<VersionDetail | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  // Restore Confirmation State
  const [versionToRestore, setVersionToRestore] = useState<VersionItem | null>(null);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [restoreSuccessText, setRestoreSuccessText] = useState<string | null>(null);

  // Concurrency tracking revision
  const [activeRevision, setActiveRevision] = useState<number>(currentRevision);

  useEffect(() => {
    if (typeof currentRevision === "number") {
      setActiveRevision((prev) => Math.max(prev, currentRevision));
    }
  }, [currentRevision]);

  // Fetch initial version list
  const fetchVersions = useCallback(async () => {
    if (!artifactId) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/artifacts/${artifactId}/versions?limit=20`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to load version history.");
      }
      const data = await res.json();
      setVersions(data.data ?? []);
      setNextCursor(data.nextCursor ?? null);
      setTotalCount(data.totalCount ?? 0);
      if (typeof data.currentRevision === "number") {
        setActiveRevision((prev) => Math.max(prev, data.currentRevision));
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error loading version history.");
    } finally {
      setIsLoading(false);
    }
  }, [artifactId]);

  // Load older versions
  const handleLoadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(
        `/api/artifacts/${artifactId}/versions?limit=20&cursor=${encodeURIComponent(nextCursor)}`
      );
      if (!res.ok) throw new Error("Failed to load older versions.");
      const data = await res.json();
      setVersions((prev) => [...prev, ...(data.data ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error loading more versions.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchVersions();
    } else {
      setPreviewVersion(null);
      setConflictError(null);
      setRestoreSuccessText(null);
    }
  }, [isOpen, fetchVersions]);

  // Create manual checkpoint
  const handleCreateCheckpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || isCreatingCheckpoint) return;

    setIsCreatingCheckpoint(true);
    setErrorMessage(null);
    try {
      const liveSnapshot = getCurrentSnapshot?.();
      const res = await fetch(`/api/artifacts/${artifactId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: checkpointTitle.trim() || currentTitle,
          changeSummary: checkpointSummary.trim() || undefined,
          snapshotData: liveSnapshot || undefined,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create checkpoint.");
      }

      const checkpointResult = await res.json();
      if (typeof checkpointResult.data?.currentRevision === "number") {
        setActiveRevision(checkpointResult.data.currentRevision);
      }

      setIsCheckpointDialogOpen(false);
      setCheckpointTitle("");
      setCheckpointSummary("");
      await fetchVersions();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to create checkpoint.");
    } finally {
      setIsCreatingCheckpoint(false);
    }
  };

  // Preview a specific historical version
  const handlePreview = async (version: VersionItem) => {
    setIsPreviewLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/artifacts/${artifactId}/versions/${version.id}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to load snapshot for preview.");
      }
      const data = await res.json();
      setPreviewVersion(data.data);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load version preview.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Execute restore
  const handleConfirmRestore = async () => {
    const target = versionToRestore || previewVersion;
    if (!target || !canEdit || isRestoring) return;

    setIsRestoring(true);
    setConflictError(null);
    try {
      const res = await fetch(`/api/artifacts/${artifactId}/versions/${target.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: activeRevision,
        }),
      });

      if (res.status === 409) {
        const conflictData = await res.json().catch(() => ({}));
        setConflictError(
          conflictData.error ||
            "Conflict: This artifact was modified by another collaborator while previewing. Please refresh history."
        );
        if (typeof conflictData.currentRevision === "number") {
          setActiveRevision(conflictData.currentRevision);
        }
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to restore version.");
      }

      const restoreResult = await res.json();
      if (typeof restoreResult.currentRevision === "number") {
        setActiveRevision(restoreResult.currentRevision);
      }

      // Apply restored state to the active editor/whiteboard live room
      await onRestore(restoreResult.snapshotData, restoreResult.title);

      setRestoreSuccessText(
        `Version ${target.versionNumber} restored successfully. Connected collaborators have received the updated state.`
      );
      setVersionToRestore(null);
      setPreviewVersion(null);

      // Refresh history list
      await fetchVersions();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to restore version.");
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 flex flex-col bg-background shadow-2xl"
          data-testid="version-history-drawer"
        >
          {/* Header */}
          <div className="p-4 border-b bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-brand-indigo text-primary" />
                <SheetTitle className="text-base font-semibold">
                  Version History
                </SheetTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {totalCount} {totalCount === 1 ? "version" : "versions"}
                </Badge>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none p-1 text-muted-foreground hover:text-foreground"
                  data-testid="close-history-drawer-btn"
                  title="Close history drawer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <SheetDescription className="text-xs text-muted-foreground mt-1">
              Browse immutable historical snapshots or restore prior state.
            </SheetDescription>

            {/* Actions Toolbar */}
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchVersions()}
                disabled={isLoading}
                className="h-8 text-xs gap-1.5"
                data-testid="refresh-history-btn"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>

              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => {
                    setCheckpointTitle(currentTitle);
                    setCheckpointSummary("");
                    setIsCheckpointDialogOpen(true);
                  }}
                  className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="create-checkpoint-btn"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Save Checkpoint
                </Button>
              )}
            </div>
          </div>

          {/* Feedback messages */}
          {restoreSuccessText && (
            <div
              className="mx-4 mt-3 p-3 text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 rounded-md flex items-start gap-2"
              data-testid="restore-success-alert"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
              <div className="flex-1">{restoreSuccessText}</div>
              <button
                onClick={() => setRestoreSuccessText(null)}
                className="text-emerald-600 hover:text-emerald-800"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {errorMessage && (
            <div
              className="mx-4 mt-3 p-3 text-xs bg-destructive/10 text-destructive border border-destructive/20 rounded-md flex items-start gap-2"
              data-testid="version-error-alert"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-destructive hover:opacity-80"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Version List */}
          <ScrollArea className="flex-1 p-4">
            {isLoading && versions.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2"
                data-testid="history-loading-spinner"
              >
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-xs">Loading version checkpoints...</span>
              </div>
            ) : versions.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-2"
                data-testid="history-empty-state"
              >
                <Clock className="h-8 w-8 stroke-[1.5] text-muted-foreground/60" />
                <p className="text-sm font-medium">No historical versions yet</p>
                <p className="text-xs max-w-xs">
                  Edits and checkpoints will automatically be recorded here as you collaborate.
                </p>
              </div>
            ) : (
              <div className="space-y-3" data-testid="version-list-container">
                {versions.map((ver) => (
                  <div
                    key={ver.id}
                    className="p-3.5 rounded-lg border bg-card hover:bg-accent/40 transition-colors flex flex-col gap-2 relative group"
                    data-testid={`version-item-${ver.versionNumber}`}
                  >
                    {/* Top Row: Version Number, Source Badge, and Timestamp */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">
                          Version {ver.versionNumber}
                        </span>
                        {getSourceBadge(ver.source)}
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatRelativeTime(ver.createdAt)}
                      </span>
                    </div>

                    {/* Title & Change Summary */}
                    <div className="text-xs font-medium text-foreground line-clamp-1">
                      {ver.title}
                    </div>

                    {ver.changeSummary && (
                      <p className="text-xs text-muted-foreground italic line-clamp-2">
                        &quot;{ver.changeSummary}&quot;
                      </p>
                    )}

                    {/* Author & Action buttons */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                          style={{
                            backgroundColor: ver.createdBy?.color || "#6366F1",
                          }}
                        >
                          {ver.createdBy?.name?.[0]?.toUpperCase() || "U"}
                        </span>
                        <span className="truncate max-w-[120px]">
                          {ver.createdBy?.name || ver.createdBy?.email}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handlePreview(ver)}
                          disabled={isPreviewLoading}
                          className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                          data-testid={`preview-version-${ver.versionNumber}-btn`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Preview
                        </Button>

                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setVersionToRestore(ver)}
                            className="h-7 px-2 text-xs gap-1 text-primary hover:bg-primary hover:text-primary-foreground"
                            data-testid={`restore-version-${ver.versionNumber}-btn`}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Restore
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {nextCursor && (
                  <div className="pt-2 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleLoadMore()}
                      disabled={isLoadingMore}
                      className="text-xs w-full"
                      data-testid="load-more-versions-btn"
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          Loading older versions...
                        </>
                      ) : (
                        "Load older versions"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Manual Checkpoint Dialog */}
      <Dialog
        open={isCheckpointDialogOpen}
        onOpenChange={(open) => !open && setIsCheckpointDialogOpen(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Save Version Checkpoint
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Create an immutable snapshot of the current {artifactType.toLowerCase()} state.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateCheckpoint} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Snapshot Title
              </label>
              <Input
                value={checkpointTitle}
                onChange={(e) => setCheckpointTitle(e.target.value)}
                placeholder="e.g. Pre-refactor baseline"
                required
                data-testid="checkpoint-title-input"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Change Summary (Optional)
              </label>
              <Textarea
                value={checkpointSummary}
                onChange={(e) => setCheckpointSummary(e.target.value)}
                placeholder="Describe what changed in this version..."
                rows={3}
                data-testid="checkpoint-summary-input"
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsCheckpointDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isCreatingCheckpoint}
                data-testid="submit-checkpoint-btn"
              >
                {isCreatingCheckpoint ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Saving...
                  </>
                ) : (
                  "Create Checkpoint"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Version Preview Modal */}
      <Dialog
        open={!!previewVersion}
        onOpenChange={(open) => !open && setPreviewVersion(null)}
      >
        <DialogContent
          className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden"
          data-testid="version-preview-modal"
        >
          {previewVersion && (
            <>
              {/* Preview Header Banner */}
              <div className="p-4 border-b bg-muted/40 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-base">
                      Preview: Version {previewVersion.versionNumber}
                    </span>
                    <Badge variant="secondary" className="text-xs font-mono">
                      Read-Only
                    </Badge>
                    {getSourceBadge(previewVersion.source)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    &quot;{previewVersion.title}&quot; &bull; Created by{" "}
                    {previewVersion.createdBy?.name || previewVersion.createdBy?.email} on{" "}
                    {new Date(previewVersion.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewVersion(null)}
                    className="h-8 text-xs"
                    data-testid="exit-preview-btn"
                  >
                    Exit Preview
                  </Button>

                  {canEdit && (
                    <Button
                      size="sm"
                      onClick={() => setVersionToRestore(previewVersion)}
                      className="h-8 text-xs gap-1.5"
                      data-testid="preview-restore-action-btn"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restore Version
                    </Button>
                  )}
                </div>
              </div>

              {/* Preview Content Area */}
              <div className="flex-1 overflow-y-auto p-6 bg-background">
                {artifactType === "DOCUMENT" ? (
                  <DocumentSnapshotPreview content={previewVersion.snapshotData} />
                ) : (
                  <WhiteboardSnapshotPreview content={previewVersion.snapshotData} />
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation Dialog */}
      <Dialog
        open={!!versionToRestore}
        onOpenChange={(open) => {
          if (!open) {
            setVersionToRestore(null);
            setConflictError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="restore-confirm-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <RotateCcw className="h-5 w-5 text-primary" />
              Restore Version {versionToRestore?.versionNumber}?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Restoring will load this snapshot into the active collaborative{" "}
              {artifactType.toLowerCase()}. All active collaborators will immediately receive the
              restored state.
            </DialogDescription>
          </DialogHeader>

          {conflictError ? (
            <div
              className="p-3 text-xs bg-destructive/10 text-destructive border border-destructive/20 rounded-md flex flex-col gap-2"
              data-testid="restore-conflict-alert"
            >
              <div className="flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Concurrent Edit Conflict:</span> {conflictError}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConflictError(null);
                  void fetchVersions();
                }}
                className="self-end text-xs h-7"
                data-testid="refresh-conflict-btn"
              >
                Refresh History
              </Button>
            </div>
          ) : (
            <div className="space-y-2 text-xs py-2 bg-muted/30 p-3 rounded-md">
              <div className="font-medium">Safety Guarantee:</div>
              <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                <li>Your current state will be preserved as a recoverable checkpoint.</li>
                <li>Future edits will continue seamlessly from the restored version.</li>
                <li>No historical versions will be overwritten or erased.</li>
              </ul>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVersionToRestore(null);
                setConflictError(null);
              }}
              disabled={isRestoring}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleConfirmRestore()}
              disabled={isRestoring || !!conflictError}
              className="gap-1.5"
              data-testid="confirm-restore-btn"
            >
              {isRestoring ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Confirm Restore
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Read-only preview renderer for Document snapshots (ProseMirror / Tiptap JSON)
 */
function DocumentSnapshotPreview({
  content,
}: {
  content: Record<string, unknown>;
}) {
  const contentArray = Array.isArray(content.content) ? content.content : [];

  if (contentArray.length === 0) {
    return (
      <div className="text-center py-12 text-xs text-muted-foreground italic">
        (Empty document snapshot)
      </div>
    );
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none space-y-4">
      {contentArray.map((node: unknown, idx: number) => {
        const item = node as {
          type?: string;
          attrs?: { level?: number };
          text?: string;
          content?: Array<{ text?: string; marks?: Array<{ type: string }> }>;
        };

        if (item.type === "heading") {
          const level = item.attrs?.level || 1;
          const text = (item.content || []).map((c) => c.text || "").join("");
          if (level === 1) return <h1 key={idx} className="text-2xl font-bold">{text}</h1>;
          if (level === 2) return <h2 key={idx} className="text-xl font-semibold mt-4">{text}</h2>;
          return <h3 key={idx} className="text-lg font-medium mt-3">{text}</h3>;
        }

        if (item.type === "paragraph") {
          const paragraphText = (item.content || []).map((c) => c.text || "").join("");
          return (
            <p key={idx} className="text-sm leading-relaxed text-foreground/90">
              {paragraphText || <br />}
            </p>
          );
        }

        if (item.type === "bulletList" || item.type === "orderedList") {
          const listItems = Array.isArray(item.content) ? item.content : [];
          return (
            <ul key={idx} className="list-disc pl-5 space-y-1 text-sm">
              {listItems.map((li: unknown, lidx: number) => {
                const liItem = li as { content?: Array<{ content?: Array<{ text?: string }> }> };
                const text = liItem.content?.[0]?.content?.map((c) => c.text || "").join("") || "";
                return <li key={lidx}>{text}</li>;
              })}
            </ul>
          );
        }

        return null;
      })}
    </div>
  );
}

/**
 * Read-only preview renderer for Whiteboard snapshots (Excalidraw scene elements)
 */
function WhiteboardSnapshotPreview({
  content,
}: {
  content: Record<string, unknown>;
}) {
  const elements = Array.isArray(content.elements) ? content.elements : [];
  const activeElements = elements.filter((el) => !el.isDeleted);

  // Group elements by type for structured inspection
  const typeCounts = activeElements.reduce((acc: Record<string, number>, el) => {
    const t = String(el.type || "unknown");
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 border rounded-lg bg-card text-center">
          <div className="text-2xl font-bold text-primary">{activeElements.length}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Active Elements</div>
        </div>
        {Object.entries(typeCounts).map(([type, count]) => (
          <div key={type} className="p-3 border rounded-lg bg-card text-center capitalize">
            <div className="text-2xl font-bold text-foreground">{count}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{type}s</div>
          </div>
        ))}
      </div>

      <div className="border rounded-lg p-4 bg-muted/20">
        <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
          <Layout className="h-4 w-4 text-primary" />
          Canvas Scene Metadata
        </h4>
        <div className="space-y-1 text-xs text-muted-foreground font-mono">
          <div>Total elements (including deleted): {elements.length}</div>
          <div>Active visible scene elements: {activeElements.length}</div>
          <div>Scene version nonce: {String(activeElements[0]?.versionNonce || "N/A")}</div>
        </div>
      </div>
    </div>
  );
}
