"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  FileText,
  FolderTree,
  History,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ActivityCategoryFilter,
  WorkspaceActivityItem,
  WorkspaceActivityResponse,
} from "@/lib/validations/activity";

const CATEGORY_TABS: Array<{
  value: ActivityCategoryFilter;
  label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "ARTIFACT", label: "Artifacts" },
  { value: "COMMENT", label: "Comments" },
  { value: "VERSION", label: "Versions" },
  { value: "ATTACHMENT", label: "Attachments" },
  { value: "PROJECT", label: "Projects" },
  { value: "MEMBER", label: "Members" },
];

function getCategoryIcon(category: WorkspaceActivityItem["category"]) {
  switch (category) {
    case "ARTIFACT":
      return <FileText className="h-3 w-3" />;
    case "PROJECT":
      return <FolderTree className="h-3 w-3" />;
    case "COMMENT":
      return <MessageSquare className="h-3 w-3" />;
    case "VERSION":
      return <History className="h-3 w-3" />;
    case "ATTACHMENT":
      return <Paperclip className="h-3 w-3" />;
    case "MEMBER":
      return <Users className="h-3 w-3" />;
  }
}

function getCategoryLabel(category: WorkspaceActivityItem["category"]): string {
  switch (category) {
    case "ARTIFACT":
      return "Artifact";
    case "PROJECT":
      return "Project";
    case "COMMENT":
      return "Comment";
    case "VERSION":
      return "Version";
    case "ATTACHMENT":
      return "Attachment";
    case "MEMBER":
      return "Workspace";
  }
}

export function formatActivityTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const nowMs = Date.now();
  const diffSeconds = Math.floor((nowMs - date.getTime()) / 1000);

  if (diffSeconds < 60) {
    return "Just now";
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export interface WorkspaceActivityFeedProps {
  workspaceId: string;
  initialItems?: WorkspaceActivityItem[];
  initialNextCursor?: string | null;
  initialHasMore?: boolean;
  pageSize?: number;
}

export function WorkspaceActivityFeed({
  workspaceId,
  initialItems,
  initialNextCursor = null,
  initialHasMore = false,
  pageSize = 15,
}: WorkspaceActivityFeedProps) {
  const hasInitialData = initialItems !== undefined;
  const [category, setCategory] = useState<ActivityCategoryFilter>("ALL");
  const [items, setItems] = useState<WorkspaceActivityItem[]>(initialItems ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [isLoading, setIsLoading] = useState<boolean>(!hasInitialData);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const prevWorkspaceIdRef = useRef<string>(workspaceId);

  const fetchActivityPage = useCallback(
    async (options: {
      targetCategory: ActivityCategoryFilter;
      cursor?: string | null;
      append: boolean;
    }) => {
      const { targetCategory, cursor, append } = options;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("limit", String(pageSize));
        params.set("category", targetCategory);
        if (cursor) {
          params.set("cursor", cursor);
        }

        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/activity?${params.toString()}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          let errMsg = "Failed to load workspace activity.";
          try {
            const errBody = (await response.json()) as { error?: string };
            if (errBody?.error) {
              errMsg = errBody.error;
            }
          } catch {
            // Ignore JSON parse failure
          }
          throw new Error(errMsg);
        }

        const data = (await response.json()) as WorkspaceActivityResponse;

        if (append) {
          setItems((prev) => {
            const seen = new Set(prev.map((i) => i.id));
            const merged = [...prev];
            for (const item of data.items) {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                merged.push(item);
              }
            }
            return merged;
          });
        } else {
          setItems(data.items);
        }

        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load workspace activity."
        );
      } finally {
        if (abortControllerRef.current === controller) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [workspaceId, pageSize]
  );

  // Sync when workspaceId or server-provided initialItems change
  useEffect(() => {
    if (prevWorkspaceIdRef.current !== workspaceId) {
      prevWorkspaceIdRef.current = workspaceId;
      setCategory("ALL");
      if (initialItems !== undefined) {
        setItems(initialItems);
        setNextCursor(initialNextCursor);
        setHasMore(initialHasMore);
        setError(null);
        setIsLoading(false);
      } else {
        void fetchActivityPage({ targetCategory: "ALL", append: false });
      }
      return;
    }

    if (!hasInitialData) {
      void fetchActivityPage({ targetCategory: "ALL", append: false });
    }
  }, [
    workspaceId,
    hasInitialData,
    initialItems,
    initialNextCursor,
    initialHasMore,
    fetchActivityPage,
  ]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleSelectCategory = (nextCategory: ActivityCategoryFilter) => {
    if (nextCategory === category && !error) {
      return;
    }
    setCategory(nextCategory);
    void fetchActivityPage({ targetCategory: nextCategory, append: false });
  };

  const handleRefresh = () => {
    void fetchActivityPage({ targetCategory: category, append: false });
  };

  const handleLoadMore = () => {
    if (!hasMore || !nextCursor || isLoadingMore || isLoading) {
      return;
    }
    void fetchActivityPage({
      targetCategory: category,
      cursor: nextCursor,
      append: true,
    });
  };

  return (
    <Card className="border" data-testid="workspace-activity-feed">
      <CardHeader className="p-4 pb-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">
              Workspace Activity
            </CardTitle>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading || isLoadingMore}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            data-testid="activity-refresh-button"
            aria-label="Refresh workspace activity"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {/* Category Filter Pills */}
        <div
          className="flex flex-wrap items-center gap-1"
          role="tablist"
          aria-label="Filter workspace activity by category"
        >
          {CATEGORY_TABS.map((tab) => {
            const active = category === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`activity-filter-${tab.value.toLowerCase()}`}
                onClick={() => handleSelectCategory(tab.value)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-1">
        {isLoading ? (
          <div
            className="flex flex-col items-center justify-center py-8 gap-2 text-xs text-muted-foreground"
            data-testid="activity-loading-state"
          >
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Loading workspace activity...</span>
          </div>
        ) : error ? (
          <div
            className="flex flex-col items-center justify-center py-6 px-3 text-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5"
            data-testid="activity-error-state"
          >
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-xs text-destructive font-medium">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="h-7 text-xs"
              data-testid="activity-retry-button"
            >
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div
            className="py-8 text-center space-y-1"
            data-testid="activity-empty-state"
          >
            <p className="text-xs font-medium text-foreground">
              No activity found
            </p>
            <p className="text-[11px] text-muted-foreground">
              {category === "ALL"
                ? "Actions across documents, whiteboards, comments, versions, and attachments will appear here."
                : `No ${category.toLowerCase()} activity events recorded yet.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3.5" data-testid="activity-feed-list">
            {items.map((item) => {
              const initials =
                item.actor.name
                  ?.trim()
                  .split(/\s+/)
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "U";

              return (
                <div
                  key={item.id}
                  data-testid="activity-feed-item"
                  data-activity-id={item.id}
                  data-activity-category={item.category}
                  className="flex items-start gap-2.5 text-xs pb-3 border-b last:border-b-0 last:pb-0"
                >
                  <div
                    className="h-6 w-6 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0 mt-0.5"
                    style={{ backgroundColor: item.actor.color || "#6366F1" }}
                    aria-hidden="true"
                  >
                    {initials}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-foreground leading-snug break-words">
                      <span
                        className="font-medium text-foreground"
                        data-testid="activity-actor-name"
                      >
                        {item.actor.name}
                      </span>{" "}
                      <span
                        className="text-muted-foreground"
                        data-testid="activity-summary"
                      >
                        {item.summary}
                      </span>
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Badge
                          variant="outline"
                          className="text-[10px] h-4 px-1.5 gap-1 font-normal text-muted-foreground"
                        >
                          {getCategoryIcon(item.category)}
                          <span>{getCategoryLabel(item.category)}</span>
                        </Badge>

                        {item.targetUrl && (
                          <Link
                            href={item.targetUrl}
                            data-testid="activity-target-link"
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline truncate max-w-[180px]"
                          >
                            <span className="truncate">
                              {item.targetTitle || "Open"}
                            </span>
                            <ArrowUpRight className="h-3 w-3 shrink-0" />
                          </Link>
                        )}
                      </div>

                      <time
                        dateTime={item.createdAt}
                        data-testid="activity-timestamp"
                        className="text-[10px] text-muted-foreground shrink-0"
                      >
                        {formatActivityTimestamp(item.createdAt)}
                      </time>
                    </div>
                  </div>
                </div>
              );
            })}

            {hasMore && nextCursor && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full h-8 text-xs"
                  data-testid="activity-load-more-button"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Loading more...
                    </>
                  ) : (
                    "Load more activity"
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
