import Link from "next/link";
import { FolderTree, FileText, PenTool, ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface ProjectDetailPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { projectId } = await params;

  // Format readable project name
  const projectName = projectId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const projectArtifacts = [
    {
      id: "doc-spec",
      type: "DOCUMENT",
      title: `${projectName} — Technical Specification & Architecture`,
      updatedAt: "2h ago",
      author: "Sunil Kumar",
      href: `/app/documents/${projectId}-spec`,
    },
    {
      id: "board-diag",
      type: "WHITEBOARD",
      title: `${projectName} — System Topology Diagram`,
      updatedAt: "Yesterday",
      author: "Alex Chen",
      href: `/app/whiteboards/${projectId}-diagram`,
    },
  ];

  return (
    <div className="container mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/app/projects" className="flex items-center gap-1 hover:text-foreground transition">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Projects</span>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <FolderTree className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{projectName}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Project artifacts, technical documentation, and visual system diagrams.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/app/documents/new-in-${projectId}`}>
            <Button size="sm" className="gap-1.5">
              <FileText className="h-4 w-4" />
              <span>New Document</span>
            </Button>
          </Link>
          <Link href={`/app/whiteboards/new-in-${projectId}`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <PenTool className="h-4 w-4 text-emerald-500" />
              <span>New Whiteboard</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="all">All Artifacts (2)</TabsTrigger>
          <TabsTrigger value="docs">Documents (1)</TabsTrigger>
          <TabsTrigger value="boards">Whiteboards (1)</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projectArtifacts.map((art) => (
              <Link key={art.id} href={art.href} className="group">
                <Card className="h-full border bg-card hover:border-primary/40 hover:shadow-sm transition">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <Badge
                        variant={art.type === "DOCUMENT" ? "brand" : "success"}
                        className="text-[10px] h-5 px-1.5"
                      >
                        {art.type === "DOCUMENT" ? (
                          <FileText className="h-3 w-3 mr-1" />
                        ) : (
                          <PenTool className="h-3 w-3 mr-1" />
                        )}
                        {art.type === "DOCUMENT" ? "Document" : "Whiteboard"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">{art.updatedAt}</span>
                    </div>
                    <CardTitle className="text-sm font-semibold group-hover:text-primary transition line-clamp-1">
                      {art.title}
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">
                      Created by {art.author}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-2 border-t mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Open editor</span>
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition text-primary" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="docs">
          <p className="text-sm text-muted-foreground py-4">Filtered to rich-text documents.</p>
        </TabsContent>

        <TabsContent value="boards">
          <p className="text-sm text-muted-foreground py-4">Filtered to visual whiteboards.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
