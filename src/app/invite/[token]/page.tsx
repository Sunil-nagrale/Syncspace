import { redirect } from "next/navigation";

export default async function InviteRedirectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/app/invitations/${encodeURIComponent(token)}`);
}
