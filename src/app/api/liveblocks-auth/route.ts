import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  AuthorizationError,
  NotFoundError,
} from "@/services/authorization.service";
import {
  LiveblocksAuthService,
  LiveblocksConfigurationError,
} from "@/services/liveblocks-auth.service";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    let body: { room?: unknown; type?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    // Fetch latest user profile attributes (including assigned presence color) from PostgreSQL
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        color: true,
      },
    });

    if (!dbUser) {
      return NextResponse.json(
        { error: "Authenticated user record not found." },
        { status: 401 }
      );
    }

    const expectedType =
      body.type === "WHITEBOARD"
        ? "WHITEBOARD"
        : body.type === "DOCUMENT"
        ? "DOCUMENT"
        : undefined;

    const result = await LiveblocksAuthService.authorizeArtifactRoom({
      user: dbUser,
      roomId: body.room,
      expectedType,
    });

    return new NextResponse(result.body, {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (err: unknown) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }

    if (err instanceof NotFoundError) {
      return NextResponse.json(
        { error: err.message },
        { status: 403 }
      );
    }

    if (err instanceof LiveblocksConfigurationError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
        },
        { status: err.statusCode }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to authorize room session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
