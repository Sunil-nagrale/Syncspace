import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { VersionService } from "@/services/version.service";
import {
  AuthorizationError,
  NotFoundError,
  ConflictError,
} from "@/services/authorization.service";
import { restoreVersionSchema } from "@/lib/validations/version";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ artifactId: string; versionId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId, versionId } = await params;
    const body = await req.json().catch(() => ({}));

    const parsed = restoreVersionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid restore payload.", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const result = await VersionService.restoreVersion(
      session.user.id,
      artifactId,
      versionId,
      {
        expectedRevision: parsed.data.expectedRevision,
      }
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json(
        {
          error: err.message,
          currentRevision: err.currentRevision,
        },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
