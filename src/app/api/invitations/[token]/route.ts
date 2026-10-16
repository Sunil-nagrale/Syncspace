import { NextResponse } from "next/server";
import { InvitationService } from "@/services/invitation.service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const result = await InvitationService.validateInvitationToken(token);

    return NextResponse.json({ data: result });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
