import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  DocumentsDirectoryClient,
  type DocumentListItem,
  type WorkspaceOption,
} from "@/components/documents/documents-directory";

const DEMO_DOCUMENTS: DocumentListItem[] = [
  {
    id: "doc-arch-spec",
    title: "Real-Time Synchronization & Yjs State Vectors",
    workspaceId: "demo-ws",
    workspaceName: "Acme Engineering",
    projectName: "Core Platform",
    liveblocksRoomId: "art_doc-arch-spec",
    updatedAtIso: new Date().toISOString(),
    authorName: "Alex Chen",
    authorColor: "#10B981",
  },
  {
    id: "doc-auth-model",
    title: "Authentication & Zero-Trust Tenancy Security",
    workspaceId: "demo-ws",
    workspaceName: "Acme Engineering",
    projectName: "API Gateway & Auth",
    liveblocksRoomId: "art_doc-auth-model",
    updatedAtIso: new Date().toISOString(),
    authorName: "Sunil Kumar",
    authorColor: "#6366F1",
  },
];

export default async function DocumentsPage() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return (
      <DocumentsDirectoryClient
        initialDocuments={DEMO_DOCUMENTS}
        workspaces={[]}
        isAuthenticated={false}
      />
    );
  }

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: session.user.id },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  const workspaceIds = memberships.map((m) => m.workspaceId);
  const workspaces: WorkspaceOption[] = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    role: m.role,
  }));

  const dbDocuments =
    workspaceIds.length > 0
      ? await prisma.artifact.findMany({
          where: {
            workspaceId: { in: workspaceIds },
            type: "DOCUMENT",
            isArchived: false,
            permissions: {
              none: {
                userId: session.user.id,
                role: "NONE",
              },
            },
          },
          include: {
            workspace: {
              select: { id: true, name: true },
            },
            project: {
              select: { id: true, name: true },
            },
            createdBy: {
              select: { id: true, name: true, email: true, color: true },
            },
          },
          orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
        })
      : [];

  const documents: DocumentListItem[] = dbDocuments.map((doc) => ({
    id: doc.id,
    title: doc.title,
    workspaceId: doc.workspaceId,
    workspaceName: doc.workspace.name,
    projectName: doc.project?.name ?? null,
    liveblocksRoomId: doc.liveblocksRoomId,
    updatedAtIso: doc.updatedAt.toISOString(),
    authorName: doc.createdBy.name || doc.createdBy.email,
    authorColor: doc.createdBy.color || "#6366F1",
  }));

  return (
    <DocumentsDirectoryClient
      initialDocuments={documents}
      workspaces={workspaces}
      isAuthenticated={true}
    />
  );
}
