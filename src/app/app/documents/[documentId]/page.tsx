import Link from "next/link";
import {
  Share2,
  ArrowLeft,
  Bold,
  Italic,
  Code,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Table as TableIcon,
  MessageSquare,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface DocumentDetailPageProps {
  params: Promise<{ documentId: string }>;
}

export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { documentId } = await params;

  const docTitle = documentId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Editor Context Header */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b bg-card/50 text-xs">
        <div className="flex items-center gap-3">
          <Link href="/app/documents" className="text-muted-foreground hover:text-foreground transition flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Docs</span>
          </Link>
          <Separator orientation="vertical" className="h-4" />
          <Badge variant="outline" className="text-[10px] gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/10">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Room: art_{documentId}</span>
          </Badge>
          <span className="text-muted-foreground">Saved locally</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Active Collaborators */}
          <div className="flex items-center -space-x-1.5">
            <div className="h-6 w-6 rounded-full bg-indigo-500 text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-background">
              JD
            </div>
            <div className="h-6 w-6 rounded-full bg-emerald-500 text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-background">
              AC
            </div>
            <div className="h-6 w-6 rounded-full bg-brand-indigo text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-background">
              SK
            </div>
          </div>

          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
            <Share2 className="h-3 w-3" />
            <span>Share</span>
          </Button>
        </div>
      </div>

      {/* Editor Formatting Ribbon Preview */}
      <div className="flex items-center gap-1 px-6 py-1.5 border-b bg-muted/20 overflow-x-auto text-muted-foreground">
        <Button variant="ghost" size="icon-sm" className="h-7 w-7"><Heading1 className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-7 w-7"><Heading2 className="h-3.5 w-3.5" /></Button>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <Button variant="ghost" size="icon-sm" className="h-7 w-7"><Bold className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-7 w-7"><Italic className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-7 w-7"><Code className="h-3.5 w-3.5" /></Button>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <Button variant="ghost" size="icon-sm" className="h-7 w-7"><List className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-7 w-7"><ListOrdered className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-7 w-7"><TableIcon className="h-3.5 w-3.5" /></Button>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <Button variant="ghost" size="icon-sm" className="h-7 w-7"><MessageSquare className="h-3.5 w-3.5" /></Button>

        <span className="ml-auto text-[11px] text-muted-foreground font-mono">
          Markdown / Shortcuts enabled
        </span>
      </div>

      {/* Notice Banner */}
      <div className="bg-brand-indigo/5 border-b border-brand-indigo/20 px-6 py-2 flex items-center justify-between text-xs text-brand-indigo">
        <div className="flex items-center gap-2">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Phase 3 UI Shell Presentation:</strong> This is the high-focus document layout. Tiptap + Yjs live multiplayer synchronization will be activated in <strong>Phase D</strong>.
          </span>
        </div>
      </div>

      {/* Document Content Canvas */}
      <div className="flex-1 overflow-y-auto p-6 sm:p-12">
        <div className="max-w-[800px] mx-auto space-y-6">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground outline-none">
            {docTitle}
          </h1>

          <div className="text-xs text-muted-foreground flex items-center gap-3">
            <span>By Sunil Kumar</span>
            <span>•</span>
            <span>Last modified 12 minutes ago</span>
            <span>•</span>
            <span>4 min read</span>
          </div>

          <Separator />

          <div className="prose dark:prose-invert max-w-none text-sm text-foreground/90 space-y-4 leading-relaxed">
            <p>
              Welcome to the collaborative document editor. In SyncSpace, documents are backed by <strong>Yjs Conflict-Free Replicated Data Types (CRDTs)</strong> connected over <strong>Liveblocks</strong> low-latency WebSockets.
            </p>

            <h2 className="text-xl font-bold tracking-tight text-foreground pt-4">
              Core Concurrency Guarantees
            </h2>

            <p>
              Traditional rich-text editors lock blocks or broadcast entire document HTML trees on every keystroke. SyncSpace relies on fine-grained CRDT trees to guarantee deterministic convergence:
            </p>

            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li><strong className="text-foreground">Monotonic Yjs State Vectors:</strong> Keystrokes are represented as continuous operations rather than text replacements.</li>
              <li><strong className="text-foreground">Isolated Undo Stacks:</strong> Pressing Ctrl+Z undoes only the local collaborator’s keystrokes.</li>
              <li><strong className="text-foreground">Selection-Anchored Discussions:</strong> Inline comments stay attached to their targeted phrases even as preceding text expands.</li>
            </ul>

            <div className="rounded-lg border bg-muted/40 p-4 text-xs font-mono space-y-1 text-muted-foreground">
              <p className="text-foreground font-semibold">{"// Architecture Boundary Verification"}</p>
              <p>const liveblocks = useLiveblocksExtension();</p>
              <p>const editor = useEditor(&#123; extensions: [StarterKit.configure(&#123; history: false &#125;), liveblocks] &#125;);</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
