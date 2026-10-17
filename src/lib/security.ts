/**
 * Security utilities for URL validation, open redirect prevention,
 * and safe request payload parsing.
 */

/**
 * Validates that an untrusted redirect parameter points to a safe relative path.
 * Strictly prevents open redirect attacks (e.g. //evil.com, https://evil.com, javascript:, data:).
 *
 * @param target The untrusted redirect target from search parameters or headers
 * @param fallback Safe default destination (defaults to "/app")
 * @returns A validated safe relative URL path or the fallback
 */
export function getSafeRedirectUrl(
  target: unknown,
  fallback: string = "/app"
): string {
  if (typeof target !== "string" || !target) {
    return fallback;
  }

  const trimmed = target.trim();
  if (!trimmed) {
    return fallback;
  }

  // Must begin with a single forward slash, and NOT start with '//' or '/\'
  // to prevent protocol-relative URLs and Windows backslash evasion tricks.
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\")
  ) {
    return fallback;
  }

  // Reject ASCII control characters and null bytes
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return fallback;
  }

  try {
    // Resolve against dummy base to verify hostname and scheme
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return fallback;
    }
    // Return relative pathname with query and hash
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}

/**
 * Validates that a user-supplied external or link URL uses an approved safe scheme.
 * Allows only http:, https:, and mailto:. Rejects javascript:, data:, vbscript:, etc.
 */
export function isSafeUrlProtocol(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

export type ParseJsonResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Safely parses JSON from an incoming Request.
 * Returns structured data on success or an error message on malformed JSON,
 * preventing unhandled 500 server crashes.
 */
export async function parseJsonBody<T = unknown>(
  req: Request
): Promise<ParseJsonResult<T>> {
  try {
    const data = await req.json();
    return { success: true, data: data as T };
  } catch {
    return { success: false, error: "Invalid JSON request body." };
  }
}
