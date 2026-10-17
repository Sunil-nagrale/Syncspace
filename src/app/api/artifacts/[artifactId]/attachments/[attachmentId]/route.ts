import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import {
  AttachmentService,
  AttachmentValidationError,
} from "@/services/attachment.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import {
  StorageConfigurationError,
  StorageError,
} from "@/lib/storage";

export async function DELETE(
  _req: Request,
  {
    params,
  }: { params: Promise<{ artifactId: string; attachmentId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId, attachmentId } = await params;

    const result = await AttachmentService.deleteAttachment(
      session.user.id,
      artifactId,
      attachmentId
    );

    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }
    if (err instanceof AttachmentValidationError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }
    if (err instanceof StorageConfigurationError) {
      return NextResponse.json(
        { error: "Attachment storage is not configured for this environment." },
        { status: 503 }
      );
    }
    if (err instanceof StorageError) {
      return NextResponse.json(
        { error: "Failed to delete attachment from storage. Please retry." },
        { status: err.statusCode || 502 }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
