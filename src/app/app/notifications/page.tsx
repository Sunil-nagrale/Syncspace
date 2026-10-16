"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AtSign, Check, Loader2, Bell, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<FormattedNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "unread">("all");

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/notifications?limit=50&filter=${activeTab}`);
      if (res.ok) {
        const json = await res.json();
        setNotifications(json.data ?? []);
        if (typeof json.pagination?.unreadCount === "number") {
          setUnreadCount(json.pagination.unreadCount);
        }
      }
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

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

  const handleNotificationClick = async (notif: FormattedNotification) => {
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
  };

  return (
    <div className="container mx-auto max-w-4xl p-6 sm:p-8 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Activity updates, document mentions, comment threads, and workspace alerts.
          </p>
        </div>

        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleMarkAllRead}
            disabled={isMarkingAll}
          >
            {isMarkingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            <span>Mark all as read</span>
          </Button>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as "all" | "unread")}
        className="w-full"
      >
        <TabsList className="mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread {unreadCount > 0 ? `(${unreadCount})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-3">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-brand-indigo" />
              <span className="text-xs">Loading notifications...</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
                <Bell className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                {activeTab === "unread"
                  ? "No unread notifications"
                  : "No notifications yet"}
              </h3>
              <p className="text-xs text-muted-foreground max-w-xs mt-1">
                {activeTab === "unread"
                  ? "You have reviewed all your mention alerts."
                  : "When collaborators mention you in discussion threads, they will appear here."}
              </p>
            </div>
          ) : (
            notifications.map((n) => {
              const isUnread = !n.readAt;
              const artifactType =
                n.artifact?.type || n.metadata?.artifactType || "DOCUMENT";
              const basePath =
                artifactType === "WHITEBOARD" ? "whiteboards" : "documents";
              const threadParam = n.threadId ? `?thread=${n.threadId}` : "";
              const href = n.artifactId
                ? `/app/${basePath}/${n.artifactId}${threadParam}`
                : "#";
              const artifactTitle =
                n.artifact?.title ||
                n.metadata?.artifactTitle ||
                "Untitled Artifact";

              return (
                <Link
                  key={n.id}
                  href={href}
                  onClick={() => void handleNotificationClick(n)}
                >
                  <Card
                    className={`border transition hover:border-primary/40 hover:shadow-sm mb-3 ${
                      isUnread
                        ? "bg-muted/30 border-brand-indigo/30"
                        : "bg-card"
                    }`}
                  >
                    <CardContent className="p-4 flex items-start gap-3">
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5"
                        style={{ backgroundColor: n.actor.color || "#6366F1" }}
                      >
                        <AtSign className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            {n.actor.name}{" "}
                            <span className="font-normal text-muted-foreground">
                              mentioned you in
                            </span>{" "}
                            {artifactTitle}
                          </p>
                          <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            <span>{formatRelativeTime(n.createdAt)}</span>
                          </span>
                        </div>
                        {n.metadata?.snippet && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed bg-muted/40 px-2.5 py-1.5 rounded border border-border/40 font-mono">
                            {n.metadata.snippet}
                          </p>
                        )}
                      </div>
                      {isUnread && (
                        <span
                          className="h-2 w-2 rounded-full bg-brand-indigo shrink-0 mt-2"
                          title="Unread"
                        />
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
