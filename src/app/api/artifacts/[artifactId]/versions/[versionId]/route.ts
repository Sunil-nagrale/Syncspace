import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { VersionService } from "@/services/version.service";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ artifactId: string; versionId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { artifactId, versionId } = await params;

    const version = await VersionService.getVersion(
      session.user.id,
      artifactId,
      versionId
    );

    return NextResponse.json({ data: version });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
