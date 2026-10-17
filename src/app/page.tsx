import Link from "next/link";
import {
  Layers,
  FileText,
  PenTool,
  Users,
  Shield,
  ArrowRight,
  Sparkles,
  Command,
  CheckCircle2,
  MousePointer2,
  FolderTree,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto max-w-7xl flex h-14 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-semibold text-lg tracking-tight">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Layers className="h-4 w-4" />
              </div>
              <span>SyncSpace</span>
            </Link>
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
              <a href="#features" className="transition hover:text-foreground">Features</a>
              <a href="#preview" className="transition hover:text-foreground">Interface Preview</a>
              <a href="#architecture" className="transition hover:text-foreground">Architecture</a>
              <Link href="/app" className="transition hover:text-foreground">Workspace Shell</Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/app">
              <Button size="sm" className="gap-2">
                <span>Enter Workspace</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-16 pb-20 md:pt-24 md:pb-28 border-b">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <Badge variant="outline" className="px-3 py-1 gap-1.5 border-brand-indigo/30 bg-brand-indigo/5 text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-brand-indigo" />
              <span>Real-Time Collaborative Monolith</span>
            </Badge>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight max-w-4xl mx-auto leading-[1.15]">
            Where technical specifications and architecture whiteboards{" "}
            <span className="text-brand-indigo underline decoration-brand-indigo/30 underline-offset-8">
              converge in real time.
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            SyncSpace integrates Tiptap rich-text documents, Excalidraw visual whiteboards, and Liveblocks real-time synchronization into one cohesive workspace designed for modern product engineering teams.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/app">
              <Button size="lg" className="h-11 px-6 gap-2 text-base shadow-sm">
                <span>Launch Workspace</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#preview">
              <Button variant="outline" size="lg" className="h-11 px-6 text-base">
                Explore Interface
              </Button>
            </a>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>Yjs Conflict-Free CRDTs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>Excalidraw Element-Level LWW Sync</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>Server-Authorized Room Access</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>PostgreSQL & Prisma Source of Truth</span>
            </div>
          </div>
        </div>
      </section>

      {/* Purpose-Built Product Preview Mockup */}
      <section id="preview" className="py-20 bg-muted/30 border-b">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              A distraction-free canvas for technical craftsmanship
            </h2>
            <p className="mt-3 text-muted-foreground">
              Inspired by Notion’s document hierarchy, Linear’s keyboard-driven navigation, and Figma’s frictionless multiplayer presence.
            </p>
          </div>

          {/* Browser Container Mockup */}
          <div className="rounded-xl border bg-card shadow-2xl overflow-hidden max-w-5xl mx-auto">
            {/* Window Title Bar */}
            <div className="h-10 border-b bg-muted/60 px-4 flex items-center justify-between text-xs text-muted-foreground select-none">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-destructive/60" />
                  <span className="h-3 w-3 rounded-full bg-amber-500/60" />
                  <span className="h-3 w-3 rounded-full bg-emerald-500/60" />
                </div>
                <div className="ml-4 flex items-center gap-2 border-l pl-3">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium text-foreground">SyncSpace / Distributed Architecture Spec</span>
                </div>
              </div>

              {/* Collaborator Presence in Header */}
              <div className="flex items-center gap-2">
                <div className="flex items-center -space-x-1.5">
                  <div className="h-6 w-6 rounded-full bg-indigo-500 text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-background">
                    JD
                  </div>
                  <div className="h-6 w-6 rounded-full bg-emerald-500 text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-background">
                    AC
                  </div>
                  <div className="h-6 w-6 rounded-full bg-amber-500 text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-background">
                    SL
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                  3 Active
                </Badge>
              </div>
            </div>

            {/* Split Preview Grid: Document + Architecture Whiteboard */}
            <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[460px]">
              {/* Document Pane (7 Cols) */}
              <div className="lg:col-span-7 p-6 sm:p-8 border-b lg:border-b-0 lg:border-r bg-background">
                <div className="max-w-xl mx-auto space-y-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground pb-2 border-b">
                    <span>Document Editor • Tiptap + Yjs</span>
                    <span className="text-emerald-500 font-medium">● Connected</span>
                  </div>

                  <h3 className="text-2xl font-bold tracking-tight text-foreground">
                    1. Real-Time Distributed Architecture
                  </h3>

                  <p className="text-sm text-muted-foreground leading-relaxed">
                    SyncSpace uses conflict-free replicated data types (CRDTs) to reconcile concurrent text keystrokes without locking sections. Liveblocks acts as the low-latency WebSocket layer, providing state vector diffs across clients.
                  </p>

                  <div className="rounded-lg border bg-muted/40 p-3.5 text-xs font-mono space-y-1 text-muted-foreground">
                    <p className="text-foreground font-semibold">{"// State Synchronization Pipeline"}</p>
                    <p><span className="text-brand-indigo">const</span> yDoc = liveblocksProvider.getYDoc();</p>
                    <p><span className="text-brand-indigo">const</span> editor = new Editor(&#123; extensions: [Collaboration.configure(&#123; yDoc &#125;)] &#125;);</p>
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <div className="h-4 w-4 rounded border bg-brand-indigo/10 border-brand-indigo/40 flex items-center justify-center text-brand-indigo">✓</div>
                      <span className="line-through text-muted-foreground">Implement server-side Liveblocks room token authorization</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <div className="h-4 w-4 rounded border bg-brand-indigo/10 border-brand-indigo/40 flex items-center justify-center text-brand-indigo">✓</div>
                      <span>Per-element Last-Write-Wins reconciliation for Excalidraw</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Whiteboard Pane (5 Cols) */}
              <div className="lg:col-span-5 p-6 bg-muted/20 relative flex flex-col justify-between overflow-hidden">
                <div className="flex items-center justify-between text-xs text-muted-foreground pb-2 border-b">
                  <span>Interactive Whiteboard • Excalidraw</span>
                  <span>Zoom: 100%</span>
                </div>

                {/* Simulated Diagram Objects */}
                <div className="my-auto space-y-4 py-6">
                  {/* Client Node */}
                  <div className="rounded-lg border-2 border-primary/70 bg-card p-3 shadow-sm max-w-[200px] mx-auto text-center">
                    <p className="text-xs font-semibold">Client 1 (Browser)</p>
                    <p className="text-[10px] text-muted-foreground">Tiptap + Yjs State</p>
                  </div>

                  {/* Connecting Arrow */}
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <div className="h-6 w-0.5 bg-border" />
                    <span className="text-[10px] font-mono">WSS Token Sync</span>
                    <div className="h-6 w-0.5 bg-border" />
                  </div>

                  {/* Liveblocks Relay Node */}
                  <div className="rounded-lg border-2 border-brand-indigo/80 bg-brand-indigo/5 p-3 shadow-sm max-w-[220px] mx-auto text-center">
                    <p className="text-xs font-semibold text-brand-indigo">Liveblocks Cloud</p>
                    <p className="text-[10px] text-muted-foreground">CRDT Storage & Presence</p>
                  </div>
                </div>

                {/* Simulated Collaborator Floating Cursor */}
                <div className="absolute bottom-8 right-8 flex items-center gap-1.5 pointer-events-none">
                  <MousePointer2 className="h-4 w-4 text-emerald-500 fill-emerald-500" />
                  <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                    Alex Chen
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Production Architecture Section */}
      <section id="architecture" className="py-20 bg-muted/20 border-b">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <Badge variant="outline" className="mb-3 px-3 py-1 text-xs border-primary/20 bg-primary/5 text-primary">
              Fullstack Architecture
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight">
              Production-Grade Infrastructure & Collaboration Pipeline
            </h2>
            <p className="mt-3 text-muted-foreground">
              A robust, decoupled architecture separating durable relational state, low-latency CRDT synchronization, and secure private object storage.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="rounded-xl border bg-card p-6 space-y-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm">
                01
              </div>
              <h3 className="text-base font-semibold">Next.js 15 Monolith</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                App Router architecture with React 19, server actions, route handlers, and static build isolation for production secrets.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-6 space-y-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm">
                02
              </div>
              <h3 className="text-base font-semibold">PostgreSQL & Prisma</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Relational source of truth enforcing workspace tenancy, user RBAC, cursor pagination, and immutable audit activity events.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-6 space-y-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-sm">
                03
              </div>
              <h3 className="text-base font-semibold">Liveblocks CRDT Relay</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Low-latency WebSocket sync layer. Authenticates room access server-side, reconciles concurrent edits, and broadcasts presence cursors.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-6 space-y-3">
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-sm">
                04
              </div>
              <h3 className="text-base font-semibold">Private S3 Object Store</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Staged-to-final promotion architecture preventing post-verification overwrites, with SHA-256 integrity verification on download.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Core Capabilities Grid */}
      <section id="features" className="py-20 border-b">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight">Engineered for Technical High Performance</h2>
            <p className="mt-3 text-muted-foreground">
              Every layer of SyncSpace is built on verified, modern standards with zero compromises on data integrity.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <Card className="border bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3">
                  <FileText className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Collaborative Documents</CardTitle>
                <CardDescription>
                  Rich-text editing powered by Tiptap v2 and Yjs CRDTs. Headings, code blocks, task lists, and slash commands without character collision.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 2 */}
            <Card className="border bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
                  <PenTool className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Synchronized Whiteboards</CardTitle>
                <CardDescription>
                  Full Excalidraw canvas integration synced via Liveblocks LiveMap. Monotonic versioning and reconcileElements prevent overwriting shapes.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 3 */}
            <Card className="border bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
                  <Users className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Multiplayer Presence</CardTitle>
                <CardDescription>
                  Live cursor coordinates, active element selection outlines, selection-anchored comments, and inline @mentions powered by Liveblocks.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 4 */}
            <Card className="border bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-3">
                  <FolderTree className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Workspaces & Projects</CardTitle>
                <CardDescription>
                  Hierarchical organization grouping specs and diagrams by initiative, squad, or sprint. Multi-tenant workspace isolation.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 5 */}
            <Card className="border bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-3">
                  <Command className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Command Palette</CardTitle>
                <CardDescription>
                  Keyboard-first navigation via Cmd+K. Jump instantly between projects, recent artifacts, or trigger workspace actions without mouse clicks.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Feature 6 */}
            <Card className="border bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
                  <Shield className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Server-Side Authorization</CardTitle>
                <CardDescription>
                  Zero-trust security model. Room IDs are never authorization keys; room access is strictly minted server-side against PostgreSQL permissions.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t py-10 bg-background text-sm text-muted-foreground">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Layers className="h-4 w-4" />
            <span>SyncSpace</span>
            <span className="text-xs text-muted-foreground">— Built for technical pair programming & architecture</span>
          </div>

          <div className="flex items-center gap-6">
            <Link href="/app" className="hover:text-foreground transition">
              App Shell
            </Link>
            <Link href="/app/projects" className="hover:text-foreground transition">
              Projects
            </Link>
            <Link href="/app/documents" className="hover:text-foreground transition">
              Documents
            </Link>
            <Link href="/app/whiteboards" className="hover:text-foreground transition">
              Whiteboards
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
