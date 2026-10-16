"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FormattedNotification } from "@/services/notification.service";

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

export function NotificationsPopover() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<FormattedNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  // Poll or fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (res.ok) {
        const json = await res.json();
        setUnreadCount(json.data?.unreadCount ?? 0);
      }
    } catch (err) {
      console.error("Failed to fetch unread count:", err);
    }
  }, []);

  // Fetch notifications list when popover opens or filter changes
  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/notifications?limit=30&filter=${filter}`);
      if (res.ok) {
        const json = await res.json();
        setNotifications(json.data ?? []);
        if (typeof json.pagination?.unreadCount === "number") {
          setUnreadCount(json.pagination.unreadCount);
        }
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  // Initial load and periodic polling (every 30 seconds)
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Refresh when opened
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Handle single notification click
  const handleNotificationClick = async (notif: FormattedNotification) => {
    // 1. Mark as read on server if unread
    if (!notif.readAt) {
      try {
        await fetch(`/api/notifications/${notif.id}/read`, {
          method: "PATCH",
        });
        setUnreadCount((prev) => Math.max(0, prev - 1));
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notif.id ? { ...n, readAt: new Date().toISOString() } : n
          )
        );
      } catch (err) {
        console.error("Error marking notification read:", err);
      }
    }

    setIsOpen(false);

    // 2. Navigate to destination artifact discussion
    if (notif.artifactId) {
      const artifactType =
        notif.artifact?.type || notif.metadata?.artifactType || "DOCUMENT";
      const basePath =
        artifactType === "WHITEBOARD" ? "whiteboards" : "documents";
      const threadParam = notif.threadId ? `?thread=${notif.threadId}` : "";
      router.push(`/app/${basePath}/${notif.artifactId}${threadParam}`);
    }
  };

  // Handle mark all as read
  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || isMarkingAll) return;
    setIsMarkingAll(true);
    try {
      const res = await fetch("/api/notifications/mark-all-read", {
        method: "POST",
      });
      if (res.ok) {
        setUnreadCount(0);
        const now = new Date().toISOString();
        setNotifications((prev) =>
          prev.map((n) => ({
            ...n,
            readAt: n.readAt || now,
          }))
        );
      }
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    } finally {
      setIsMarkingAll(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label={`Notifications (${unreadCount} unread)`}
          data-testid="notifications-bell"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-brand-indigo text-[10px] font-bold text-white shadow-sm ring-1 ring-background animate-in zoom-in-75"
              data-testid="notifications-unread-badge"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 sm:w-96 p-0 shadow-xl border border-border"
        data-testid="notifications-popover"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-brand-indigo/15 text-brand-indigo">
                {unreadCount} unread
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground px-2 gap-1"
                onClick={handleMarkAllRead}
                disabled={isMarkingAll}
                data-testid="mark-all-read-button"
              >
                {isMarkingAll ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCheck className="h-3.5 w-3.5 text-brand-indigo" />
                )}
                <span>Mark all read</span>
              </Button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center px-4 py-1.5 border-b border-border/50 text-xs gap-3 bg-muted/10">
          <button
            type="button"
            className={`font-medium pb-0.5 transition-colors ${
              filter === "all"
                ? "text-brand-indigo border-b-2 border-brand-indigo"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`font-medium pb-0.5 transition-colors ${
              filter === "unread"
                ? "text-brand-indigo border-b-2 border-brand-indigo"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setFilter("unread")}
          >
            Unread
          </button>
        </div>

        {/* Notifications List */}
        <ScrollArea className="max-h-[380px] divide-y divide-border/40">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-brand-indigo" />
              <span className="text-xs">Loading notifications...</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-2">
                <Bell className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium text-foreground">
                {filter === "unread"
                  ? "No unread notifications"
                  : "No notifications yet"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[200px]">
                {filter === "unread"
                  ? "You have reviewed all your mentions."
                  : "When someone mentions you in a discussion, you'll see it here."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {notifications.map((notif) => {
                const isUnread = !notif.readAt;
                const artifactTitle =
                  notif.artifact?.title ||
                  notif.metadata?.artifactTitle ||
                  "Untitled Artifact";

                return (
                  <button
                    key={notif.id}
                    type="button"
                    onClick={() => void handleNotificationClick(notif)}
                    className={`w-full text-left p-3.5 flex items-start gap-3 transition-colors hover:bg-muted/40 cursor-pointer ${
                      isUnread ? "bg-brand-indigo/[0.04]" : ""
                    }`}
                    data-testid={`notification-item-${notif.id}`}
                  >
                    {/* Actor Avatar */}
                    <div
                      className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0 shadow-xs"
                      style={{
                        backgroundColor: notif.actor.color || "#6366F1",
                      }}
                    >
                      {getInitials(notif.actor.name)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs leading-snug">
                        <span className="font-semibold text-foreground">
                          {notif.actor.name}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          mentioned you in
                        </span>{" "}
                        <span className="font-medium text-foreground underline-offset-2 hover:underline">
                          {artifactTitle}
                        </span>
                      </div>

                      {notif.metadata?.snippet && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1 bg-muted/30 px-2 py-1 rounded border border-border/40 font-mono">
                          {notif.metadata.snippet}
                        </p>
                      )}

                      <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        <span>{formatRelativeTime(notif.createdAt)}</span>
                      </div>
                    </div>

                    {/* Unread indicator */}
                    {isUnread && (
                      <span
                        className="h-2 w-2 rounded-full bg-brand-indigo shrink-0 mt-1"
                        title="Unread"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
