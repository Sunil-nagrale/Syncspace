import Link from "next/link";
import { FolderTree, Plus, Search, ArrowUpRight, FileText, PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function ProjectsPage() {
  const projects = [
    {
      id: "core-platform",
      name: "Core Platform",
      description: "Foundational synchronization pipelines, CRDT state trees, and database schemas.",
      docsCount: 3,
      boardsCount: 2,
      updatedAt: "12m ago",
      members: 4,
    },
    {
      id: "api-gateway",
      name: "API Gateway & Auth",
      description: "Reverse proxies, session cookie rotation, and Liveblocks room token authorization.",
      docsCount: 2,
      boardsCount: 1,
      updatedAt: "3h ago",
      members: 3,
    },
    {
      id: "mobile-redesign",
      name: "Mobile Redesign",
      description: "Touch gesture support for Excalidraw canvas and responsive document layouts.",
      docsCount: 1,
      boardsCount: 1,
      updatedAt: "2d ago",
      members: 2,
    },
  ];

  return (
    <div className="container mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Organize documents and whiteboards by initiative, squad, or milestone.
          </p>
        </div>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          <span>New Project</span>
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Filter projects by title..." className="pl-9" />
        </div>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((proj) => (
          <Link key={proj.id} href={`/app/projects/${proj.id}`} className="group">
            <Card className="h-full border bg-card hover:border-primary/40 hover:shadow-md transition">
              <CardHeader className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="h-9 w-9 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <FolderTree className="h-5 w-5" />
                  </div>
                  <span className="text-xs text-muted-foreground">Updated {proj.updatedAt}</span>
                </div>
                <CardTitle className="text-base font-semibold group-hover:text-primary transition">
                  {proj.name}
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                  {proj.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0 border-t mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    <span>{proj.docsCount}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <PenTool className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{proj.boardsCount}</span>
                  </span>
                  <span>•</span>
                  <span>{proj.members} members</span>
                </div>
                <ArrowUpRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition text-primary" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
