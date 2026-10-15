import Link from "next/link";
import {
  PenTool,
  Share2,
  Download,
  ArrowLeft,
  Square,
  Circle,
  Diamond,
  ArrowRight,
  Minus,
  Pencil,
  Type,
  Eraser,
  MousePointer,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface WhiteboardDetailPageProps {
  params: Promise<{ boardId: string }>;
}

export default async function WhiteboardDetailPage({ params }: WhiteboardDetailPageProps) {
  const { boardId } = await params;

  const boardTitle = boardId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      {/* Whiteboard Header */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b bg-card/60 backdrop-blur-sm text-xs z-20">
        <div className="flex items-center gap-3">
          <Link href="/app/whiteboards" className="text-muted-foreground hover:text-foreground transition flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Boards</span>
          </Link>
          <Separator orientation="vertical" className="h-4" />
          <span className="font-semibold text-foreground text-sm truncate max-w-[200px]">{boardTitle}</span>
          <Badge variant="outline" className="text-[10px] gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/10">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Room: art_{boardId}</span>
          </Badge>
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
          </div>

          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
            <Download className="h-3 w-3" />
            <span>Export</span>
          </Button>

          <Button size="sm" variant="default" className="h-7 text-xs gap-1.5">
            <Share2 className="h-3 w-3" />
            <span>Share</span>
          </Button>
        </div>
      </div>

      {/* Floating Excalidraw Toolbar Mockup */}
      <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-xl border bg-card p-1 shadow-lg">
        <Button variant="secondary" size="icon-sm" className="h-8 w-8"><MousePointer className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-8 w-8"><Square className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-8 w-8"><Diamond className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-8 w-8"><Circle className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-8 w-8"><ArrowRight className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-8 w-8"><Minus className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-8 w-8"><Pencil className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-8 w-8"><Type className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon-sm" className="h-8 w-8"><Eraser className="h-4 w-4" /></Button>
      </div>

      {/* Notice Banner */}
      <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-6 py-2 flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300 z-10">
        <div className="flex items-center gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>
            <strong>Phase 3 UI Shell Presentation:</strong> Excalidraw dynamic client canvas and Liveblocks <code>LiveMap</code> CRDT synchronization will be activated in <strong>Phase E</strong>.
          </span>
        </div>
      </div>

      {/* Whiteboard Interactive Canvas Area */}
      <div className="flex-1 bg-muted/20 relative flex items-center justify-center p-8 select-none">
        {/* Dot Grid Background */}
        <div
          className="absolute inset-0 opacity-40 dark:opacity-20"
          style={{
            backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Center Mockup Architecture Diagram */}
        <div className="relative z-10 flex flex-col items-center gap-8 max-w-2xl text-center">
          <div className="rounded-xl border-2 border-dashed border-primary/40 bg-card/80 p-8 shadow-sm backdrop-blur-sm space-y-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <PenTool className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-bold tracking-tight">Excalidraw Multiplayer Canvas Ready</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
              In Phase E, this viewport will mount the full Excalidraw drawing canvas. Scene elements will be synced across peers via Liveblocks <code>LiveMap</code> and merged using <code>reconcileElements</code>.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Badge variant="outline" className="text-xs">
                Element-level LWW
              </Badge>
              <Badge variant="outline" className="text-xs">
                PNG & SVG Export
              </Badge>
              <Badge variant="outline" className="text-xs">
                Touch Gestures
              </Badge>
            </div>
          </div>
        </div>

        {/* Bottom Zoom & View Controls */}
        <div className="absolute bottom-6 left-6 z-20 flex items-center gap-1 rounded-lg border bg-card p-1 shadow-md text-xs text-muted-foreground">
          <Button variant="ghost" size="icon-sm" className="h-7 w-7"><ZoomOut className="h-3.5 w-3.5" /></Button>
          <span className="px-2 font-mono">100%</span>
          <Button variant="ghost" size="icon-sm" className="h-7 w-7"><ZoomIn className="h-3.5 w-3.5" /></Button>
          <Separator orientation="vertical" className="h-4 mx-1" />
          <Button variant="ghost" size="icon-sm" className="h-7 w-7"><Maximize2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}
