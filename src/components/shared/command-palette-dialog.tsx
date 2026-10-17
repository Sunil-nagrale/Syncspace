"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  FileText,
  FolderTree,
  Home,
  Loader2,
  PenTool,
  RefreshCw,
  Settings,
  Users,
  X,
} from "lucide-react";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import type {
  SearchEntityFilter,
  SearchResponse,
  SearchResultEntityType,
  SearchResultItem,
} from "@/lib/validations/search";

export interface CommandPaletteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
  debounceMs?: number;
}

interface StaticNavigationCommand {
  id: string;
  label: string;
  href: string;
  shortcut?: string;
  group: "Navigation" | "Administration & Settings";
  keywords: string[];
  icon: React.ComponentType<{ className?: string }>;
}

const STATIC_COMMANDS: StaticNavigationCommand[] = [
  {
    id: "nav-dashboard",
    label: "Workspace Dashboard",
    href: "/app",
    shortcut: "GH",
    group: "Navigation",
    keywords: ["dashboard", "home", "overview", "workspace"],
    icon: Home,
  },
  {
    id: "nav-projects",
    label: "All Projects",
    href: "/app/projects",
    shortcut: "GP",
    group: "Navigation",
    keywords: ["projects", "directory", "folders", "roadmap"],
    icon: FolderTree,
  },
  {
    id: "nav-documents",
    label: "Documents Directory",
    href: "/app/documents",
    shortcut: "GD",
    group: "Navigation",
    keywords: ["documents", "docs", "notes", "pages", "wiki"],
    icon: FileText,
  },
  {
    id: "nav-whiteboards",
    label: "Whiteboards Gallery",
    href: "/app/whiteboards",
    shortcut: "GW",
    group: "Navigation",
    keywords: ["whiteboards", "boards", "canvas", "excalidraw", "diagrams"],
    icon: PenTool,
  },
  {
    id: "nav-notifications",
    label: "Notifications Inbox",
    href: "/app/notifications",
    shortcut: "GN",
    group: "Navigation",
    keywords: ["notifications", "inbox", "alerts", "mentions"],
    icon: Bell,
  },
  {
    id: "admin-members",
    label: "Manage Workspace Members",
    href: "/app/members",
    group: "Administration & Settings",
    keywords: ["members", "users", "team", "permissions", "roles", "invite"],
    icon: Users,
  },
  {
    id: "admin-settings",
    label: "Workspace Settings",
    href: "/app/settings",
    group: "Administration & Settings",
    keywords: ["settings", "preferences", "workspace", "configuration"],
    icon: Settings,
  },
];

const ENTITY_FILTER_OPTIONS: {
  value: SearchEntityFilter;
  label: string;
}[] = [
  { value: "ALL", label: "All" },
  { value: "DOCUMENT", label: "Documents" },
  { value: "WHITEBOARD", label: "Whiteboards" },
  { value: "PROJECT", label: "Projects" },
];

function getEntityMeta(entityType: SearchResultEntityType): {
  label: string;
  badgeClassName: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  switch (entityType) {
    case "DOCUMENT":
      return {
        label: "Document",
        badgeClassName:
          "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
        Icon: FileText,
      };
    case "WHITEBOARD":
      return {
        label: "Whiteboard",
        badgeClassName:
          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        Icon: PenTool,
      };
    case "PROJECT":
      return {
        label: "Project",
        badgeClassName:
          "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
        Icon: FolderTree,
      };
  }
}

export function CommandPaletteDialog({
  open,
  onOpenChange,
  workspaceId,
  debounceMs = 180,
}: CommandPaletteDialogProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [entityFilter, setEntityFilter] =
    React.useState<SearchEntityFilter>("ALL");
  const [items, setItems] = React.useState<SearchResultItem[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [retryCounter, setRetryCounter] = React.useState(0);

  // Global Cmd+K / Ctrl+K shortcut listener
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(!open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  // Reset transient error when closing
  React.useEffect(() => {
    if (!open) {
      setError(null);
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [open]);

  const buildSearchUrl = React.useCallback(
    (searchQuery: string, filter: SearchEntityFilter, cursor?: string) => {
      const params = new URLSearchParams();
      const trimmed = searchQuery.trim();
      if (trimmed.length > 0) {
        params.set("q", trimmed);
        params.set("limit", "12");
      } else {
        params.set("includeRecent", "true");
        params.set("limit", "8");
      }

      if (filter !== "ALL") {
        params.set("type", filter);
      }
      if (workspaceId) {
        params.set("workspaceId", workspaceId);
      }
      if (cursor) {
        params.set("cursor", cursor);
      }

      return `/api/search?${params.toString()}`;
    },
    [workspaceId]
  );

  // Fetch live search results or recent accessible items when dialog is open
  React.useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const trimmed = query.trim();
    const delay = trimmed.length === 0 ? 0 : debounceMs;

    setIsLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(buildSearchUrl(query, entityFilter), {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (!res.ok) {
          let message = "Failed to load search results.";
          try {
            const errBody = (await res.json()) as { error?: string };
            if (errBody?.error) {
              message = errBody.error;
            }
          } catch {
            // Use fallback message
          }
          throw new Error(message);
        }

        const payload = (await res.json()) as { data?: SearchResponse };
        if (controller.signal.aborted) return;

        const data = payload.data;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setNextCursor(data?.nextCursor ?? null);
        setHasMore(Boolean(data?.hasMore));
        setError(null);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error
            ? err.message
            : "Unable to complete search request.";
        setError(message);
        setItems([]);
        setNextCursor(null);
        setHasMore(false);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, entityFilter, retryCounter, debounceMs, buildSearchUrl]);

  const handleLoadMore = async () => {
    if (!nextCursor || isLoadingMore || isLoading) return;

    setIsLoadingMore(true);
    setError(null);
    try {
      const res = await fetch(
        buildSearchUrl(query, entityFilter, nextCursor),
        {
          method: "GET",
          headers: { Accept: "application/json" },
        }
      );

      if (!res.ok) {
        let message = "Failed to load additional results.";
        try {
          const errBody = (await res.json()) as { error?: string };
          if (errBody?.error) {
            message = errBody.error;
          }
        } catch {
          // Ignore parse error
        }
        throw new Error(message);
      }

      const payload = (await res.json()) as { data?: SearchResponse };
      const data = payload.data;
      const newItems = Array.isArray(data?.items) ? data.items : [];

      setItems((prev) => {
        const existingKeys = new Set(
          prev.map((item) => `${item.entityType}:${item.id}`)
        );
        const deduped = newItems.filter(
          (item) => !existingKeys.has(`${item.entityType}:${item.id}`)
        );
        return [...prev, ...deduped];
      });
      setNextCursor(data?.nextCursor ?? null);
      setHasMore(Boolean(data?.hasMore));
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to load additional results.";
      setError(message);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const runCommand = React.useCallback(
    (command: () => void) => {
      onOpenChange(false);
      command();
    },
    [onOpenChange]
  );

  const trimmedQuery = query.trim().toLowerCase();

  const matchingStaticCommands = React.useMemo(() => {
    if (entityFilter !== "ALL") {
      return [];
    }
    if (trimmedQuery.length === 0) {
      return STATIC_COMMANDS;
    }
    return STATIC_COMMANDS.filter((cmd) => {
      if (cmd.label.toLowerCase().includes(trimmedQuery)) return true;
      return cmd.keywords.some((kw) => kw.includes(trimmedQuery));
    });
  }, [entityFilter, trimmedQuery]);

  const navigationCommands = React.useMemo(
    () =>
      matchingStaticCommands.filter((cmd) => cmd.group === "Navigation"),
    [matchingStaticCommands]
  );

  const adminCommands = React.useMemo(
    () =>
      matchingStaticCommands.filter(
        (cmd) => cmd.group === "Administration & Settings"
      ),
    [matchingStaticCommands]
  );

  const showEmptyState =
    !isLoading &&
    !error &&
    items.length === 0 &&
    matchingStaticCommands.length === 0;

  const resultsHeading =
    trimmedQuery.length > 0
      ? `Search Results (${items.length}${hasMore ? "+" : ""})`
      : "Recent & Accessible Items";

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      contentClassName="max-w-2xl"
    >
      <div
        data-testid="command-palette-dialog"
        className="flex flex-col w-full"
      >
        <div className="relative">
          <CommandInput
            data-testid="command-palette-input"
            value={query}
            onValueChange={setQuery}
            placeholder="Search documents, whiteboards, projects, or type a command..."
          />
          {query.length > 0 && (
            <button
              type="button"
              data-testid="command-palette-clear"
              onClick={() => setQuery("")}
              aria-label="Clear search query"
              className="absolute right-10 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Entity Type Filter Bar */}
        <div
          className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5"
          role="group"
          aria-label="Filter search results by type"
        >
          <div className="flex items-center gap-1 overflow-x-auto">
            {ENTITY_FILTER_OPTIONS.map((option) => {
              const isActive = entityFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  data-testid={`command-palette-filter-${option.value}`}
                  aria-pressed={isActive}
                  onClick={() => setEntityFilter(option.value)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <span className="hidden sm:inline-block text-[11px] text-muted-foreground">
            ↑↓ to navigate · ↵ to open · Esc to close
          </span>
        </div>

        <CommandList className="max-h-[420px]">
          {/* Loading State */}
          {isLoading && (
            <div
              data-testid="command-palette-loading"
              role="status"
              aria-live="polite"
              className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Searching workspace...</span>
            </div>
          )}

          {/* Error State */}
          {!isLoading && error && (
            <div
              data-testid="command-palette-error"
              role="alert"
              className="mx-3 my-4 flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                data-testid="command-palette-retry"
                onClick={() => setRetryCounter((c) => c + 1)}
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* Empty State */}
          {showEmptyState && (
            <div
              data-testid="command-palette-empty"
              className="py-8 text-center text-sm text-muted-foreground"
            >
              No matching documents, whiteboards, projects, or commands found.
            </div>
          )}

          {/* Search / Recent Results Group */}
          {!isLoading && !error && items.length > 0 && (
            <CommandGroup heading={resultsHeading}>
              {items.map((item) => {
                const { label, badgeClassName, Icon } = getEntityMeta(
                  item.entityType
                );
                return (
                  <CommandItem
                    key={`${item.entityType}-${item.id}`}
                    value={`${item.entityType}:${item.id}:${item.title}`}
                    data-testid="command-palette-result-item"
                    data-entity-type={item.entityType}
                    data-entity-id={item.id}
                    onSelect={() =>
                      runCommand(() => {
                        router.push(item.url);
                      })
                    }
                    className="flex items-start justify-between gap-3 py-2.5 cursor-pointer"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            data-testid="command-palette-result-title"
                            className="truncate font-medium text-foreground"
                          >
                            {item.title}
                          </span>
                          <span
                            data-testid="command-palette-result-badge"
                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${badgeClassName}`}
                          >
                            {label}
                          </span>
                          {item.projectName &&
                            item.entityType !== "PROJECT" && (
                              <span className="truncate text-[11px] text-muted-foreground">
                                in {item.projectName}
                              </span>
                            )}
                        </div>
                        {item.excerpt && (
                          <p
                            data-testid="command-palette-result-excerpt"
                            className="mt-1 line-clamp-1 text-xs text-muted-foreground"
                          >
                            {item.excerpt}
                          </p>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60" />
                  </CommandItem>
                );
              })}

              {hasMore && nextCursor && (
                <div className="px-2 py-1.5">
                  <button
                    type="button"
                    data-testid="command-palette-load-more"
                    disabled={isLoadingMore}
                    onClick={handleLoadMore}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {isLoadingMore ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Loading more...</span>
                      </>
                    ) : (
                      <span>Load more results</span>
                    )}
                  </button>
                </div>
              )}
            </CommandGroup>
          )}

          {!isLoading &&
            !error &&
            items.length > 0 &&
            matchingStaticCommands.length > 0 && <CommandSeparator />}

          {/* Static Navigation Commands */}
          {navigationCommands.length > 0 && (
            <CommandGroup heading="Navigation">
              {navigationCommands.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <CommandItem
                    key={cmd.id}
                    value={`command:${cmd.id}:${cmd.label}`}
                    data-testid={`command-palette-nav-${cmd.id}`}
                    onSelect={() => runCommand(() => router.push(cmd.href))}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{cmd.label}</span>
                    {cmd.shortcut && (
                      <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {navigationCommands.length > 0 && adminCommands.length > 0 && (
            <CommandSeparator />
          )}

          {/* Administration & Settings Commands */}
          {adminCommands.length > 0 && (
            <CommandGroup heading="Administration & Settings">
              {adminCommands.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <CommandItem
                    key={cmd.id}
                    value={`command:${cmd.id}:${cmd.label}`}
                    data-testid={`command-palette-nav-${cmd.id}`}
                    onSelect={() => runCommand(() => router.push(cmd.href))}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{cmd.label}</span>
                    {cmd.shortcut && (
                      <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </div>
    </CommandDialog>
  );
}
