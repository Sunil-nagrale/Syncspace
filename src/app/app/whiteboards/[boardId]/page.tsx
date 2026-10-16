import { notFound } from "next/navigation";
import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ArtifactService } from "@/services/artifact.service";
import { isLiveblocksSecretKeyConfigured } from "@/services/liveblocks-auth.service";
import { CollaborativeWhiteboardClient } from "@/components/whiteboards/collaborative-whiteboard-client";
import type { WhiteboardSnapshotData } from "@/components/whiteboards/types";

const DEMO_BOARD_IDS = new Set([
  "board-data-pipeline",
  "board-service-mesh",
  "board-mobile-ux",
]);

interface WhiteboardDetailPageProps {
  params: Promise<{ boardId: string }>;
}

export default async function WhiteboardDetailPage({
  params,
}: WhiteboardDetailPageProps) {
  const { boardId } = await params;
  const liveblocksConfigured = isLiveblocksSecretKeyConfigured();

  if (DEMO_BOARD_IDS.has(boardId)) {
    const demoTitle = boardId
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    return (
      <CollaborativeWhiteboardClient
        whiteboardId={boardId}
        workspaceId="demo-workspace"
        workspaceName="Acme Engineering"
        projectName="Core Platform"
        initialTitle={demoTitle}
        liveblocksRoomId={`art_${boardId}`}
        effectiveRole="EDITOR"
        authorName="Sunil Kumar"
        updatedAtIso={new Date().toISOString()}
        initialSnapshot={null}
        liveblocksConfigured={liveblocksConfigured}
        isDemoMode={true}
        currentUser={{
          id: "demo-user",
          name: "Sunil Kumar",
          email: "sunil@syncspace.dev",
          color: "#6366F1",
        }}
      />
    );
  }

  const session = await getServerSession();
  if (!session?.user?.id) {
    notFound();
  }

  try {
    const result = await ArtifactService.getArtifactById(
      session.user.id,
      boardId
    );

    if (result.artifact.type !== "WHITEBOARD") {
      notFound();
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        color: true,
      },
    });

    const rawSnapshot =
      result.artifact.currentSnapshot ?? result.artifact.versions?.[0]?.snapshotData;
    const initialSnapshot =
      rawSnapshot && typeof rawSnapshot === "object"
        ? (rawSnapshot as unknown as WhiteboardSnapshotData)
        : null;

    return (
      <CollaborativeWhiteboardClient
        whiteboardId={result.artifact.id}
        workspaceId={result.artifact.workspaceId}
        workspaceName={result.artifact.workspace?.name ?? "Workspace"}
        projectName={result.artifact.project?.name ?? null}
        initialTitle={result.artifact.title}
        liveblocksRoomId={result.artifact.liveblocksRoomId}
        effectiveRole={
          result.effectiveRole as "OWNER" | "ADMIN" | "EDITOR" | "VIEWER"
        }
        authorName={
          result.artifact.createdBy?.name ||
          result.artifact.createdBy?.email ||
          "Collaborator"
        }
        updatedAtIso={result.artifact.updatedAt.toISOString()}
        initialSnapshot={initialSnapshot}
        currentRevision={result.artifact.currentRevision}
        liveblocksConfigured={liveblocksConfigured}
        isDemoMode={false}
        currentUser={
          dbUser
            ? {
                id: dbUser.id,
                name: dbUser.name,
                email: dbUser.email,
                color: dbUser.color,
              }
            : null
        }
      />
    );
  } catch {
    notFound();
  }
}
