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
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  initiateAttachmentUploadSchema,
  listAttachmentsQuerySchema,
} from "@/lib/validations/attachment";

function handleAttachmentRouteError(err: unknown): NextResponse {
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
      { error: "Storage operation failed. Please retry." },
      { status: err.statusCode || 502 }
    );
  }
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId } = await params;
    const url = new URL(req.url);

    const queryParse = listAttachmentsQuerySchema.safeParse({
      limit: url.searchParams.get("limit") || undefined,
    });

    if (!queryParse.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters.",
          details: queryParse.error.format(),
        },
        { status: 400 }
      );
    }

    const result = await AttachmentService.listAttachments(
      session.user.id,
      artifactId,
      queryParse.data
    );

    return NextResponse.json({
      data: result.items,
      totalCount: result.totalCount,
    });
  } catch (err: unknown) {
    return handleAttachmentRouteError(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId } = await params;
    const contentType = (req.headers.get("content-type") || "").toLowerCase();

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData().catch(() => null);
      if (!formData) {
        return NextResponse.json(
          { error: "Invalid multipart form data." },
          { status: 400 }
        );
      }

      const fileEntry = formData.get("file");
      if (!fileEntry || typeof fileEntry === "string" || !("arrayBuffer" in fileEntry)) {
        return NextResponse.json(
          { error: "A file field is required in multipart upload." },
          { status: 400 }
        );
      }

      if (fileEntry.size <= 0) {
        return NextResponse.json(
          { error: "Empty files cannot be uploaded." },
          { status: 400 }
        );
      }

      if (fileEntry.size > MAX_ATTACHMENT_SIZE_BYTES) {
        return NextResponse.json(
          {
            error: `File size (${fileEntry.size} bytes) exceeds the maximum limit of 10 MiB (${MAX_ATTACHMENT_SIZE_BYTES} bytes).`,
          },
          { status: 400 }
        );
      }

      const arrayBuffer = await fileEntry.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      const attachment = await AttachmentService.uploadAttachment(
        session.user.id,
        artifactId,
        {
          fileName: fileEntry.name || "attachment",
          fileType: fileEntry.type || "application/octet-stream",
          bytes,
        }
      );

      return NextResponse.json({ data: attachment }, { status: 201 });
    }

    // JSON initiation flow (two-step presigned or staged upload)
    const body = await req.json().catch(() => ({}));
    const parsed = initiateAttachmentUploadSchema.safeParse(body);

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || "Invalid upload request payload.";
      return NextResponse.json(
        {
          error: firstIssue,
          details: parsed.error.format(),
        },
        { status: 400 }
      );
    }

    const result = await AttachmentService.initiateUpload(
      session.user.id,
      artifactId,
      parsed.data
    );

    return NextResponse.json(
      {
        data: result.attachment,
        uploadTarget: result.uploadTarget,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    return handleAttachmentRouteError(err);
  }
}
