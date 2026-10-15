import Link from "next/link";
import { MessageSquare, AtSign, UserPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function NotificationsPage() {
  const notifications = [
    {
      id: "notif-1",
      type: "MENTION",
      title: "Alex Chen mentioned you",
      detail: "in Real-Time Synchronization & Yjs State Vectors: '@Sunil please verify the state vector boundary.'",
      time: "15m ago",
      read: false,
      href: "/app/documents/doc-arch-spec",
    },
    {
      id: "notif-2",
      type: "COMMENT",
      title: "Jane Doe commented on your whiteboard",
      detail: "in Distributed Data Ingestion Pipeline: 'Should we add Kafka buffering here?'",
      time: "2h ago",
      read: false,
      href: "/app/whiteboards/board-data-pipeline",
    },
    {
      id: "notif-3",
      type: "INVITE",
      title: "New member joined workspace",
      detail: "Sarah Jenkins joined Acme Engineering as an Editor.",
      time: "Yesterday",
      read: true,
      href: "/app/members",
    },
  ];

  return (
    <div className="container mx-auto max-w-4xl p-6 sm:p-8 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Activity updates, document mentions, comment threads, and workspace alerts.
          </p>
        </div>

        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          <Check className="h-3.5 w-3.5" />
          <span>Mark all as read</span>
        </Button>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="all">All (3)</TabsTrigger>
          <TabsTrigger value="unread">Unread (2)</TabsTrigger>
          <TabsTrigger value="mentions">Mentions (1)</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-3">
          {notifications.map((n) => (
            <Link key={n.id} href={n.href}>
              <Card
                className={`border transition hover:border-primary/40 hover:shadow-sm mb-3 ${
                  !n.read ? "bg-muted/30 border-brand-indigo/30" : "bg-card"
                }`}
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    {n.type === "MENTION" ? (
                      <AtSign className="h-4 w-4 text-brand-indigo" />
                    ) : n.type === "COMMENT" ? (
                      <MessageSquare className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <UserPlus className="h-4 w-4 text-amber-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">{n.title}</p>
                      <span className="text-[11px] text-muted-foreground shrink-0">{n.time}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                      {n.detail}
                    </p>
                  </div>
                  {!n.read && (
                    <span className="h-2 w-2 rounded-full bg-brand-indigo shrink-0 mt-2" />
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </TabsContent>

        <TabsContent value="unread">
          <p className="text-xs text-muted-foreground py-2">Showing unread alerts.</p>
        </TabsContent>

        <TabsContent value="mentions">
          <p className="text-xs text-muted-foreground py-2">Showing direct @mentions.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
