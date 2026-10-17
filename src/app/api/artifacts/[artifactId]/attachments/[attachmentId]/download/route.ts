import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import {
  AttachmentIntegrityError,
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
import { downloadAttachmentQuerySchema } from "@/lib/validations/attachment";

export async function GET(
  req: Request,
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
    const url = new URL(req.url);

    const queryParse = downloadAttachmentQuerySchema.safeParse({
      disposition: url.searchParams.get("disposition") || undefined,
    });

    if (!queryParse.success) {
      return NextResponse.json(
        { error: "Invalid download disposition parameter." },
        { status: 400 }
      );
    }

    const payload = await AttachmentService.getDownloadPayload(
      session.user.id,
      artifactId,
      attachmentId,
      queryParse.data.disposition
    );

    return new NextResponse(Buffer.from(payload.bytes), {
      status: 200,
      headers: payload.headers,
    });
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
    if (err instanceof AttachmentIntegrityError) {
      return NextResponse.json(
        {
          error:
            "Attachment integrity verification failed. The file cannot be downloaded.",
        },
        { status: err.statusCode || 500 }
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
        { error: "Failed to retrieve attachment content." },
        { status: err.statusCode || 502 }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
