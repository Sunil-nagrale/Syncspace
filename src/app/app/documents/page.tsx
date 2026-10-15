import Link from "next/link";
import { FileText, Plus, Search, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function DocumentsPage() {
  const documents = [
    {
      id: "doc-arch-spec",
      title: "Real-Time Synchronization & Yjs State Vectors",
      project: "Core Platform",
      updatedAt: "12m ago",
      author: "Alex Chen",
      initials: "AC",
      color: "bg-emerald-500",
    },
    {
      id: "doc-auth-model",
      title: "Authentication & Zero-Trust Tenancy Security",
      project: "API Gateway & Auth",
      updatedAt: "3h ago",
      author: "Sunil Kumar",
      initials: "SK",
      color: "bg-brand-indigo",
    },
    {
      id: "doc-liveblocks-eval",
      title: "Liveblocks Room Token Authorization Architecture",
      project: "API Gateway & Auth",
      updatedAt: "Yesterday",
      author: "Jane Doe",
      initials: "JD",
      color: "bg-indigo-500",
    },
    {
      id: "doc-excalidraw-reconcile",
      title: "Excalidraw Element-Level LWW Reconciliation Strategy",
      project: "Core Platform",
      updatedAt: "2d ago",
      author: "Alex Chen",
      initials: "AC",
      color: "bg-emerald-500",
    },
  ];

  return (
    <div className="container mx-auto max-w-7xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Concurrent rich-text technical documentation powered by Tiptap and Yjs.
          </p>
        </div>
        <Link href="/app/documents/new-doc">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>New Document</span>
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Filter documents by title..." className="pl-9" />
        </div>
      </div>

      {/* Documents List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {documents.map((doc) => (
          <Link key={doc.id} href={`/app/documents/${doc.id}`} className="group">
            <Card className="h-full border bg-card hover:border-primary/40 hover:shadow-sm transition">
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <Badge variant="brand" className="text-[10px] h-5 px-1.5">
                    <FileText className="h-3 w-3 mr-1" />
                    Document
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">Edited {doc.updatedAt}</span>
                </div>
                <CardTitle className="text-sm font-semibold group-hover:text-primary transition line-clamp-1">
                  {doc.title}
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  {doc.project}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2 border-t mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className={`h-4 w-4 rounded-full ${doc.color} text-[9px] font-bold text-white flex items-center justify-center`}>
                    {doc.initials}
                  </div>
                  <span>{doc.author}</span>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition text-primary" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
