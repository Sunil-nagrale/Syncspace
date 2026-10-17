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

function handleCompletionError(err: unknown): NextResponse {
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

async function handleComplete(
  req: Request,
  paramsPromise: Promise<{ artifactId: string; attachmentId: string }>
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId, attachmentId } = await paramsPromise;
    const contentType = (req.headers.get("content-type") || "").toLowerCase();

    let optionalBytes: Uint8Array | undefined;
    if (!contentType.includes("application/json")) {
      const buf = await req.arrayBuffer().catch(() => null);
      if (buf && buf.byteLength > 0) {
        optionalBytes = new Uint8Array(buf);
      }
    }

    const completed = await AttachmentService.completeUpload(
      session.user.id,
      artifactId,
      attachmentId,
      optionalBytes
    );

    return NextResponse.json({ data: completed }, { status: 200 });
  } catch (err: unknown) {
    return handleCompletionError(err);
  }
}

export async function POST(
  req: Request,
  {
    params,
  }: { params: Promise<{ artifactId: string; attachmentId: string }> }
) {
  return handleComplete(req, params);
}

export async function PUT(
  req: Request,
  {
    params,
  }: { params: Promise<{ artifactId: string; attachmentId: string }> }
) {
  return handleComplete(req, params);
}
