"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Paperclip,
  Upload,
  Download,
  Eye,
  Trash2,
  FileText,
  FileImage,
  FileSpreadsheet,
  File,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Lock,
  X,
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
import { ScrollArea } from "@/components/ui/scroll-area";

export interface AttachmentItem {
  id: string;
  workspaceId: string;
  artifactId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: "PENDING" | "READY" | "FAILED" | "DELETING";
  sha256: string | null;
  uploadedById: string;
  createdAt: string;
  updatedAt: string;
  uploadedBy: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    color?: string | null;
  };
  canDelete: boolean;
  inlinePreviewSupported: boolean;
}

export interface AttachmentDrawerProps {
  artifactId: string;
  artifactType: "DOCUMENT" | "WHITEBOARD";
  canEdit: boolean;
  isOpen: boolean;
  onClose: () => void;
  onCountChange?: (count: number) => void;
  isDemoMode?: boolean;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUploadDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return "Just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

function getFileTypeBadge(mimeType: string): {
  label: string;
  icon: React.ReactNode;
} {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized === "application/pdf") {
    return {
      label: "PDF",
      icon: <FileText className="h-4 w-4 text-rose-500 shrink-0" />,
    };
  }
  if (normalized.startsWith("image/")) {
    const subtype = normalized.split("/")[1]?.toUpperCase() || "IMAGE";
    return {
      label: subtype,
      icon: <FileImage className="h-4 w-4 text-brand-indigo shrink-0" />,
    };
  }
  if (normalized === "text/csv") {
    return {
      label: "CSV",
      icon: <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />,
    };
  }
  if (normalized === "text/plain") {
    return {
      label: "TXT",
      icon: <FileText className="h-4 w-4 text-amber-500 shrink-0" />,
    };
  }
  return {
    label: "FILE",
    icon: <File className="h-4 w-4 text-muted-foreground shrink-0" />,
  };
}

export function AttachmentDrawer({
  artifactId,
  artifactType,
  canEdit,
  isOpen,
  onClose,
  onCountChange,
  isDemoMode = false,
}: AttachmentDrawerProps) {
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [lastFailedFile, setLastFailedFile] = useState<File | null>(null);

  const [previewAttachment, setPreviewAttachment] =
    useState<AttachmentItem | null>(null);
  const [previewTextContent, setPreviewTextContent] = useState<string | null>(
    null
  );
  const [isLoadingPreviewText, setIsLoadingPreviewText] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [deleteCandidate, setDeleteCandidate] =
    useState<AttachmentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAttachments = useCallback(async () => {
    if (isDemoMode || !artifactId) return;
    setIsLoading(true);
    setListError(null);
    try {
      const res = await fetch(`/api/artifacts/${artifactId}/attachments`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load attachments.");
      }
      const json = await res.json();
      const items: AttachmentItem[] = json.data ?? [];
      setAttachments(items);
      onCountChange?.(items.length);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Failed to load attachments."
      );
    } finally {
      setIsLoading(false);
    }
  }, [artifactId, isDemoMode, onCountChange]);

  useEffect(() => {
    if (isOpen) {
      void fetchAttachments();
    }
  }, [isOpen, fetchAttachments]);

  const performFileUpload = useCallback(
    async (file: File) => {
      if (!canEdit || isDemoMode) return;
      setIsUploading(true);
      setUploadProgress(20);
      setUploadError(null);
      setUploadSuccess(null);
      setLastFailedFile(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        setUploadProgress(60);

        const res = await fetch(`/api/artifacts/${artifactId}/attachments`, {
          method: "POST",
          body: formData,
        });

        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          setLastFailedFile(file);
          throw new Error(
            json.error || `Upload failed with status ${res.status}.`
          );
        }

        setUploadProgress(100);
        const created: AttachmentItem | undefined = json.data;
        if (created) {
          setAttachments((prev) => {
            const next = [
              created,
              ...prev.filter((item) => item.id !== created.id),
            ];
            onCountChange?.(next.length);
            return next;
          });
        } else {
          await fetchAttachments();
        }
        setUploadSuccess(`Uploaded "${file.name}"`);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to upload attachment."
        );
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [artifactId, canEdit, isDemoMode, fetchAttachments, onCountChange]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    void performFileUpload(selected);
  };

  const handleOpenPreview = useCallback(
    async (item: AttachmentItem) => {
      setPreviewAttachment(item);
      setPreviewTextContent(null);
      setPreviewError(null);

      if (item.fileType === "text/plain") {
        setIsLoadingPreviewText(true);
        try {
          const res = await fetch(
            `/api/artifacts/${artifactId}/attachments/${item.id}/download?disposition=inline`,
            { cache: "no-store" }
          );
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || "Failed to load file preview.");
          }
          const text = await res.text();
          setPreviewTextContent(text);
        } catch (err) {
          setPreviewError(
            err instanceof Error ? err.message : "Failed to load preview."
          );
        } finally {
          setIsLoadingPreviewText(false);
        }
      }
    },
    [artifactId]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteCandidate) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(
        `/api/artifacts/${artifactId}/attachments/${deleteCandidate.id}`,
        {
          method: "DELETE",
        }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to delete attachment.");
      }

      const deletedId = deleteCandidate.id;
      setAttachments((prev) => {
        const next = prev.filter((a) => a.id !== deletedId);
        onCountChange?.(next.length);
        return next;
      });
      if (previewAttachment?.id === deletedId) {
        setPreviewAttachment(null);
      }
      setDeleteCandidate(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete attachment."
      );
    } finally {
      setIsDeleting(false);
    }
  }, [artifactId, deleteCandidate, onCountChange, previewAttachment]);

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md md:max-w-lg flex flex-col p-0 gap-0"
          data-testid="attachment-drawer"
        >
          {/* Drawer Header */}
          <div className="p-4 border-b bg-card/50 flex items-center justify-between pr-10">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-brand-indigo" />
                <SheetTitle className="text-sm font-semibold">
                  Attachments
                </SheetTitle>
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0"
                  data-testid="attachment-count-badge"
                >
                  {attachments.length}
                </Badge>
              </div>
              <SheetDescription className="text-xs text-muted-foreground">
                Private files attached to this{" "}
                {artifactType === "WHITEBOARD" ? "whiteboard" : "document"}
              </SheetDescription>
            </div>

            <Button
              size="icon-sm"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => void fetchAttachments()}
              disabled={isLoading}
              aria-label="Refresh attachments"
              data-testid="attachment-refresh-button"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>

          {/* Upload Action Area or Viewer Notice */}
          <div className="p-4 border-b bg-muted/20 space-y-3">
            {canEdit ? (
              <div className="space-y-2.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  onChange={handleFileChange}
                  disabled={isUploading}
                  aria-label="Select file to attach"
                  data-testid="attachment-file-input"
                />

                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground leading-tight">
                    Allowed: <strong>PDF, PNG, JPEG, WebP, TXT, CSV</strong> (up
                    to 10 MiB)
                  </div>
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5 shrink-0"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="attachment-upload-button"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-3.5 w-3.5" />
                        <span>Upload File</span>
                      </>
                    )}
                  </Button>
                </div>

                {isUploading && (
                  <div
                    className="space-y-1"
                    data-testid="attachment-upload-progress"
                  >
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-brand-indigo transition-all duration-200"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Validating signature & storing in private object storage...
                    </p>
                  </div>
                )}

                {uploadError && (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start justify-between gap-2"
                    data-testid="attachment-upload-error"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{uploadError}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {lastFailedFile && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => void performFileUpload(lastFailedFile)}
                          data-testid="attachment-upload-retry"
                        >
                          Retry
                        </Button>
                      )}
                      <button
                        type="button"
                        onClick={() => setUploadError(null)}
                        className="text-destructive/80 hover:text-destructive p-0.5"
                        aria-label="Dismiss upload error"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {uploadSuccess && !uploadError && (
                  <div
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2"
                    data-testid="attachment-upload-success"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span className="truncate">{uploadSuccess}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUploadSuccess(null)}
                      className="text-emerald-700/70 dark:text-emerald-300/70 hover:opacity-100 p-0.5"
                      aria-label="Dismiss upload notification"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="flex items-center gap-2 text-xs text-muted-foreground py-1"
                data-testid="attachment-viewer-readonly-notice"
              >
                <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>
                  Read-only access: You can preview and download attachments,
                  but uploading or deleting files requires editor permissions.
                </span>
              </div>
            )}
          </div>

          {/* Attachment List Body */}
          <ScrollArea className="flex-1 p-4">
            {isLoading && attachments.length === 0 ? (
              <div
                className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground"
                data-testid="attachment-list-loading"
              >
                <Loader2 className="h-5 w-5 animate-spin text-brand-indigo" />
                <span>Loading attachments...</span>
              </div>
            ) : listError ? (
              <div
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive space-y-2"
                data-testid="attachment-list-error"
              >
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{listError}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => void fetchAttachments()}
                  data-testid="attachment-list-retry"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Retry</span>
                </Button>
              </div>
            ) : attachments.length === 0 ? (
              <div
                className="py-12 px-4 text-center space-y-2"
                data-testid="attachment-empty-state"
              >
                <div className="mx-auto h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-xs font-medium text-foreground">
                  No files attached yet
                </div>
                <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                  Attach reference PDFs, architecture diagrams, screenshots, or
                  CSV datasets to keep them alongside this{" "}
                  {artifactType === "WHITEBOARD" ? "whiteboard" : "document"}.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5" data-testid="attachment-list">
                {attachments.map((item) => {
                  const badgeInfo = getFileTypeBadge(item.fileType);
                  const downloadHref = `/api/artifacts/${artifactId}/attachments/${item.id}/download?disposition=attachment`;

                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border bg-card p-3 space-y-2 hover:border-brand-indigo/30 transition"
                      data-testid="attachment-item"
                      data-attachment-id={item.id}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="mt-0.5">{badgeInfo.icon}</div>
                          <div className="min-w-0 space-y-0.5">
                            <div
                              className="text-xs font-medium text-foreground truncate"
                              title={item.fileName}
                              data-testid="attachment-item-name"
                            >
                              {item.fileName}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 h-4 font-mono"
                              >
                                {badgeInfo.label}
                              </Badge>
                              <span>{formatFileSize(item.fileSize)}</span>
                              <span>•</span>
                              <span>{item.uploadedBy?.name || "Member"}</span>
                              <span>•</span>
                              <span>{formatUploadDate(item.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/50">
                        {item.inlinePreviewSupported && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => void handleOpenPreview(item)}
                            data-testid="attachment-preview-button"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Preview</span>
                          </Button>
                        )}

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs gap-1"
                          asChild
                        >
                          <a
                            href={downloadHref}
                            download={item.fileName}
                            data-testid="attachment-download-button"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Download</span>
                          </a>
                        </Button>

                        {item.canDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteCandidate(item);
                            }}
                            aria-label={`Delete ${item.fileName}`}
                            data-testid="attachment-delete-button"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Safe Attachment Preview Dialog */}
      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewAttachment(null);
            setPreviewTextContent(null);
            setPreviewError(null);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-2xl max-h-[85vh] flex flex-col"
          data-testid="attachment-preview-dialog"
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold truncate pr-6">
              {previewAttachment?.fileName}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {previewAttachment
                ? `${previewAttachment.fileType} • ${formatFileSize(previewAttachment.fileSize)} • Uploaded by ${previewAttachment.uploadedBy?.name || "Member"}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-[240px] max-h-[60vh] overflow-auto rounded-md border bg-muted/20 flex items-center justify-center p-3">
            {previewAttachment &&
              previewAttachment.fileType.startsWith("image/") && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/artifacts/${artifactId}/attachments/${previewAttachment.id}/download?disposition=inline`}
                  alt={previewAttachment.fileName}
                  className="max-h-[55vh] max-w-full object-contain rounded"
                  data-testid="attachment-preview-image"
                />
              )}

            {previewAttachment &&
              previewAttachment.fileType === "application/pdf" && (
                <iframe
                  src={`/api/artifacts/${artifactId}/attachments/${previewAttachment.id}/download?disposition=inline`}
                  title={previewAttachment.fileName}
                  sandbox=""
                  className="w-full h-[55vh] rounded border-0 bg-background"
                  data-testid="attachment-preview-pdf"
                />
              )}

            {previewAttachment &&
              previewAttachment.fileType === "text/plain" && (
                <div className="w-full h-full self-start">
                  {isLoadingPreviewText ? (
                    <div className="py-12 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading text preview...</span>
                    </div>
                  ) : previewError ? (
                    <div className="text-xs text-destructive p-4">
                      {previewError}
                    </div>
                  ) : (
                    <pre
                      className="text-xs font-mono whitespace-pre-wrap break-words p-2 text-foreground"
                      data-testid="attachment-preview-text"
                    >
                      {previewTextContent}
                    </pre>
                  )}
                </div>
              )}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setPreviewAttachment(null)}
            >
              Close
            </Button>
            {previewAttachment && (
              <Button size="sm" className="text-xs gap-1.5" asChild>
                <a
                  href={`/api/artifacts/${artifactId}/attachments/${previewAttachment.id}/download?disposition=attachment`}
                  download={previewAttachment.fileName}
                  data-testid="attachment-preview-download-button"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download File</span>
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteCandidate)}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteCandidate(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="attachment-delete-confirm-dialog"
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              Delete Attachment
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to permanently delete{" "}
              <strong className="text-foreground">
                {deleteCandidate?.fileName}
              </strong>
              ? This removes the file from private storage and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-center gap-2"
              data-testid="attachment-delete-error"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{deleteError}</span>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              disabled={isDeleting}
              onClick={() => setDeleteCandidate(null)}
              data-testid="attachment-delete-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="text-xs gap-1.5"
              disabled={isDeleting}
              onClick={() => void handleConfirmDelete()}
              data-testid="attachment-delete-confirm"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete File</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
