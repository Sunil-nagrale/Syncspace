import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  WhiteboardsDirectoryClient,
  type WhiteboardListItem,
  type WorkspaceOption,
} from "@/components/whiteboards/whiteboards-directory";

const DEMO_WHITEBOARDS: WhiteboardListItem[] = [
  {
    id: "board-data-pipeline",
    title: "Distributed Data Ingestion Pipeline",
    workspaceId: "demo-ws",
    workspaceName: "Acme Engineering",
    projectName: "Core Platform",
    liveblocksRoomId: "art_board-data-pipeline",
    updatedAtIso: new Date().toISOString(),
    authorName: "Jane Doe",
    authorColor: "#6366F1",
  },
  {
    id: "board-service-mesh",
    title: "System Component Topologies & Gateway Relay",
    workspaceId: "demo-ws",
    workspaceName: "Acme Engineering",
    projectName: "API Gateway & Auth",
    liveblocksRoomId: "art_board-service-mesh",
    updatedAtIso: new Date().toISOString(),
    authorName: "Alex Chen",
    authorColor: "#10B981",
  },
  {
    id: "board-mobile-ux",
    title: "Mobile Canvas Navigation & Gestures Wireframe",
    workspaceId: "demo-ws",
    workspaceName: "Acme Engineering",
    projectName: "Mobile Redesign",
    liveblocksRoomId: "art_board-mobile-ux",
    updatedAtIso: new Date().toISOString(),
    authorName: "Sunil Kumar",
    authorColor: "#EC4899",
  },
];

export default async function WhiteboardsPage() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return (
      <WhiteboardsDirectoryClient
        initialWhiteboards={DEMO_WHITEBOARDS}
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

  const dbWhiteboards =
    workspaceIds.length > 0
      ? await prisma.artifact.findMany({
          where: {
            workspaceId: { in: workspaceIds },
            type: "WHITEBOARD",
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

  const whiteboards: WhiteboardListItem[] = dbWhiteboards.map((board) => ({
    id: board.id,
    title: board.title,
    workspaceId: board.workspaceId,
    workspaceName: board.workspace.name,
    projectName: board.project?.name ?? null,
    liveblocksRoomId: board.liveblocksRoomId,
    updatedAtIso: board.updatedAt.toISOString(),
    authorName: board.createdBy.name || board.createdBy.email,
    authorColor: board.createdBy.color || "#6366F1",
  }));

  return (
    <WhiteboardsDirectoryClient
      initialWhiteboards={whiteboards}
      workspaces={workspaces}
      isAuthenticated={true}
    />
  );
}
