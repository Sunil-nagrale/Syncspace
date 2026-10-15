import Link from "next/link";
import {
  FileText,
  PenTool,
  FolderTree,
  Clock,
  ArrowUpRight,
  Activity,
  Building,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getServerSession } from "@/lib/session";
import { WorkspaceService } from "@/services/workspace.service";
import { ProjectService } from "@/services/project.service";
import { ArtifactService } from "@/services/artifact.service";
import { prisma } from "@/lib/prisma";
import { CreateWorkspaceDialog } from "@/components/workspaces/create-workspace-dialog";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { CreateArtifactDialog } from "@/components/artifacts/create-artifact-dialog";

export default async function WorkspaceDashboard() {
  const session = await getServerSession();
  const userId = session?.user?.id;

  let workspaces: Awaited<ReturnType<typeof WorkspaceService.getUserWorkspaces>> = [];
  let activeWorkspace: (typeof workspaces)[0] | null = null;
  let projects: Awaited<ReturnType<typeof ProjectService.getWorkspaceProjects>> = [];
  let artifacts: Awaited<ReturnType<typeof ArtifactService.getWorkspaceArtifacts>> = [];
  let activityEvents: Array<{
    id: string;
    action: string;
    createdAt: Date;
    user: { name: string; color: string };
    metadata: unknown;
  }> = [];

  if (userId) {
    try {
      workspaces = await WorkspaceService.getUserWorkspaces(userId);
      if (workspaces.length > 0) {
        activeWorkspace = workspaces[0];

        // Fetch projects and artifacts in parallel
        const [loadedProjects, loadedArtifacts, loadedActivities] = await Promise.all([
          ProjectService.getWorkspaceProjects(userId, activeWorkspace.id),
          ArtifactService.getWorkspaceArtifacts(userId, activeWorkspace.id),
          prisma.activityEvent.findMany({
            where: { workspaceId: activeWorkspace.id },
            include: {
              user: {
                select: { name: true, color: true },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
        ]);

        projects = loadedProjects;
        artifacts = loadedArtifacts;
        activityEvents = loadedActivities;
      }
    } catch (e) {
      console.error("Failed to query workspace data:", e);
    }
  }

  // If user has no workspaces or database is empty, display the Onboarding State
  if (!activeWorkspace) {
    return (
      <div className="container mx-auto max-w-5xl p-6 sm:p-12 space-y-8">
        <div className="text-center space-y-3 max-w-xl mx-auto py-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mx-auto mb-4">
            <Building className="h-6 w-6" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome to SyncSpace
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Create your first collaborative workspace to start organizing documents, whiteboards, and projects with real-time synchronization.
          </p>

          <div className="pt-4 flex items-center justify-center gap-3">
            <CreateWorkspaceDialog />
            {!session && (
              <Link href="/login">
                <Button variant="outline" size="sm">
                  Sign in to existing account
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t">
          <Card className="border bg-card/60">
            <CardHeader className="p-4 pb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 mb-2">
                <FileText className="h-4 w-4" />
              </div>
              <CardTitle className="text-sm font-semibold">Tiptap & Yjs Documents</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Rich text editing backed by conflict-free replicated data types.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border bg-card/60">
            <CardHeader className="p-4 pb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 mb-2">
                <PenTool className="h-4 w-4" />
              </div>
              <CardTitle className="text-sm font-semibold">Excalidraw Whiteboards</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Infinite canvas whiteboarding with granular LiveMap element sync.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border bg-card/60">
            <CardHeader className="p-4 pb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500 mb-2">
                <Sparkles className="h-4 w-4" />
              </div>
              <CardTitle className="text-sm font-semibold">Better Auth & Prisma 7</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Multi-tenant PostgreSQL isolation with strict role-based access control.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl p-6 sm:p-8 space-y-8">
      {/* Welcome Banner & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {activeWorkspace.name}
            </h1>
            <Badge variant="outline" className="text-xs">
              {activeWorkspace.currentUserRole}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Workspace overview • {projects.length} {projects.length === 1 ? "project" : "projects"}, {artifacts.length} {artifacts.length === 1 ? "artifact" : "artifacts"}.
          </p>
        </div>

        {/* Quick Create Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <CreateArtifactDialog
            workspaceId={activeWorkspace.id}
            type="DOCUMENT"
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          />
          <CreateArtifactDialog
            workspaceId={activeWorkspace.id}
            type="WHITEBOARD"
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          />
          <CreateProjectDialog workspaceId={activeWorkspace.id} />
        </div>
      </div>

      {/* Main Grid: Artifacts & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Recent Artifacts & Projects (8 Cols) */}
        <div className="lg:col-span-8 space-y-8">
          {/* Jump Back In Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold text-foreground">Recent Artifacts</h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {artifacts.length} {artifacts.length === 1 ? "item" : "items"}
              </span>
            </div>

            {artifacts.length === 0 ? (
              <Card className="border border-dashed p-8 text-center bg-card/40">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted mx-auto mb-3 text-muted-foreground">
                  <FileText className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-medium text-foreground mb-1">
                  No documents or whiteboards yet
                </h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
                  Get started by creating a new document or whiteboard in this workspace.
                </p>
                <div className="flex items-center justify-center gap-2">
                  <CreateArtifactDialog
                    workspaceId={activeWorkspace.id}
                    type="DOCUMENT"
                    projects={projects.map((p) => ({ id: p.id, name: p.name }))}
                  />
                  <CreateArtifactDialog
                    workspaceId={activeWorkspace.id}
                    type="WHITEBOARD"
                    projects={projects.map((p) => ({ id: p.id, name: p.name }))}
                  />
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {artifacts.map((item) => (
                  <Link
                    key={item.id}
                    href={
                      item.type === "DOCUMENT"
                        ? `/app/documents/${item.id}`
                        : `/app/whiteboards/${item.id}`
                    }
                    className="group"
                  >
                    <Card className="h-full border bg-card transition-all duration-200 hover:border-primary/40 hover:shadow-md">
                      <CardHeader className="p-4 pb-2">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <Badge
                            variant={item.type === "DOCUMENT" ? "brand" : "success"}
                            className="text-[10px] h-5 px-1.5"
                          >
                            {item.type === "DOCUMENT" ? (
                              <FileText className="h-3 w-3 mr-1" />
                            ) : (
                              <PenTool className="h-3 w-3 mr-1" />
                            )}
                            {item.type === "DOCUMENT" ? "Document" : "Whiteboard"}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(item.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <CardTitle className="text-sm font-semibold group-hover:text-primary transition-colors line-clamp-1">
                          {item.title}
                        </CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                          {(item as { project?: { name: string } | null }).project?.name || "Workspace Root"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 pt-2 flex items-center justify-between border-t mt-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-4 w-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center bg-primary"
                          >
                            {(item as { createdBy?: { name: string } }).createdBy?.name?.slice(0, 2).toUpperCase() || "ME"}
                          </div>
                          <span>
                            {(item as { createdBy?: { name: string } }).createdBy?.name || "Member"}
                          </span>
                        </div>
                        <ArrowUpRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Active Projects Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderTree className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold text-foreground">Active Projects</h2>
              </div>
              <div className="flex items-center gap-2">
                <CreateProjectDialog workspaceId={activeWorkspace.id} />
                <Link
                  href="/app/projects"
                  className="text-xs text-muted-foreground hover:text-foreground transition"
                >
                  View all ({projects.length})
                </Link>
              </div>
            </div>

            {projects.length === 0 ? (
              <Card className="border border-dashed p-6 text-center bg-card/40">
                <p className="text-xs text-muted-foreground mb-3">
                  No active projects in this workspace yet.
                </p>
                <CreateProjectDialog workspaceId={activeWorkspace.id} />
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {projects.map((proj) => (
                  <Link
                    key={proj.id}
                    href={`/app/projects/${proj.id}`}
                    className="group"
                  >
                    <Card className="h-full border bg-card/60 transition hover:border-primary/40 hover:shadow-sm">
                      <CardHeader className="p-4">
                        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:text-foreground transition mb-2">
                          <FolderTree className="h-4 w-4" />
                        </div>
                        <CardTitle className="text-sm font-semibold group-hover:text-primary transition">
                          {proj.name}
                        </CardTitle>
                        <CardDescription className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {proj.description || "No description provided."}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 text-[11px] text-muted-foreground flex items-center gap-3">
                        <span>{(proj as { _count?: { artifacts: number } })._count?.artifacts ?? 0} Artifacts</span>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Tenancy Status & Activity Feed (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Tenancy & Security Status Card */}
          <Card className="border">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between mb-1">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tenant Details
                </CardTitle>
                <Badge variant="brand" className="text-[10px]">
                  PostgreSQL Active
                </Badge>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground pt-1">
                <div className="flex justify-between">
                  <span>Slug:</span>
                  <span className="font-mono text-foreground">{activeWorkspace.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span>Role:</span>
                  <span className="font-medium text-foreground">{activeWorkspace.currentUserRole}</span>
                </div>
                <div className="flex justify-between">
                  <span>Isolation:</span>
                  <span className="text-emerald-500 font-medium">RBAC Enforced</span>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Activity Stream */}
          <Card className="border">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Workspace Activity</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {activityEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No activity events recorded yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {activityEvents.map((act) => (
                    <div key={act.id} className="flex items-start gap-2.5 text-xs">
                      <div
                        className="h-5 w-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0 mt-0.5 bg-primary"
                      >
                        {act.user.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground leading-snug">
                          <span className="font-medium">{act.user.name}</span>{" "}
                          <span className="text-muted-foreground">{act.action}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
