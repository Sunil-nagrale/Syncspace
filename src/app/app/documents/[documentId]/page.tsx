import { notFound } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ArtifactService } from "@/services/artifact.service";
import { isLiveblocksSecretKeyConfigured } from "@/services/liveblocks-auth.service";
import { CollaborativeDocumentView } from "@/components/documents/collaborative-editor";

const DEMO_DOC_IDS = new Set([
  "doc-arch-spec",
  "doc-auth-model",
  "doc-liveblocks-eval",
  "doc-excalidraw-reconcile",
]);

interface DocumentDetailPageProps {
  params: Promise<{ documentId: string }>;
}

export default async function DocumentDetailPage({
  params,
}: DocumentDetailPageProps) {
  const { documentId } = await params;
  const liveblocksConfigured = isLiveblocksSecretKeyConfigured();

  if (DEMO_DOC_IDS.has(documentId)) {
    const demoTitle = documentId
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    return (
      <CollaborativeDocumentView
        documentId={documentId}
        workspaceId="demo-workspace"
        workspaceName="Acme Engineering"
        projectName="Core Platform"
        initialTitle={demoTitle}
        liveblocksRoomId={`art_${documentId}`}
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
      documentId
    );

    if (result.artifact.type !== "DOCUMENT") {
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

    const latestVersion = result.artifact.versions?.[0];
    const initialSnapshot =
      latestVersion?.snapshotData &&
      typeof latestVersion.snapshotData === "object"
        ? (latestVersion.snapshotData as unknown as JSONContent)
        : null;

    return (
      <CollaborativeDocumentView
        documentId={result.artifact.id}
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
