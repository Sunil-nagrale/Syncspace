import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { AuthorizationError } from "@/services/authorization.service";

/**
 * Retrieve the current authenticated session on the server.
 */
export async function getServerSession() {
  const reqHeaders = await headers();
  return auth.api.getSession({
    headers: reqHeaders,
  });
}

/**
 * Assert that a valid session exists, returning the authenticated user.
 * Throws AuthorizationError(401) if unauthenticated.
 */
export async function requireAuthUser() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    throw new AuthorizationError("Authentication required.", 401);
  }
  return session.user;
}
