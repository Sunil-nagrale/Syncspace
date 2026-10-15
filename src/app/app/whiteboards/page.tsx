import Link from "next/link";
import { PenTool, Plus, Search, ArrowUpRight, Layout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function WhiteboardsPage() {
  const whiteboards = [
    {
      id: "board-data-pipeline",
      title: "Distributed Data Ingestion Pipeline",
      project: "Core Platform",
      updatedAt: "1h ago",
      shapesCount: 24,
      author: "Jane Doe",
      collaborators: 3,
    },
    {
      id: "board-service-mesh",
      title: "System Component Topologies & Gateway Relay",
      project: "API Gateway & Auth",
      updatedAt: "Yesterday",
      shapesCount: 42,
      author: "Alex Chen",
      collaborators: 2,
    },
    {
      id: "board-mobile-ux",
      title: "Mobile Canvas Navigation & Gestures Wireframe",
      project: "Mobile Redesign",
      updatedAt: "3d ago",
      shapesCount: 16,
      author: "Sunil Kumar",
      collaborators: 1,
    },
  ];

  return (
    <div className="container mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Whiteboards</h1>
          <p className="text-sm text-muted-foreground">
            Multiplayer visual canvases powered by Excalidraw with element-level CRDT synchronization.
          </p>
        </div>
        <Link href="/app/whiteboards/new-board">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>New Whiteboard</span>
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Filter whiteboards by title..." className="pl-9" />
        </div>
      </div>

      {/* Whiteboards Gallery */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {whiteboards.map((board) => (
          <Link key={board.id} href={`/app/whiteboards/${board.id}`} className="group">
            <Card className="h-full border bg-card hover:border-primary/40 hover:shadow-md transition overflow-hidden">
              {/* Visual Canvas Preview Thumbnail */}
              <div className="h-36 bg-muted/30 border-b flex items-center justify-center relative p-4 group-hover:bg-muted/50 transition">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Layout className="h-8 w-8 stroke-1 text-primary/40" />
                  <span className="text-[10px] font-mono">{board.shapesCount} shapes synced</span>
                </div>
                <div className="absolute top-2 right-2">
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-background/80">
                    {board.collaborators} Active
                  </Badge>
                </div>
              </div>

              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="success" className="text-[10px] h-5 px-1.5">
                    <PenTool className="h-3 w-3 mr-1" />
                    Whiteboard
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{board.updatedAt}</span>
                </div>
                <CardTitle className="text-sm font-semibold group-hover:text-primary transition line-clamp-1">
                  {board.title}
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  {board.project}
                </CardDescription>
              </CardHeader>

              <CardContent className="p-4 pt-2 border-t mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>By {board.author}</span>
                <ArrowUpRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition text-primary" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
