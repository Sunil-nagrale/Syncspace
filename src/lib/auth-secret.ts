import { randomBytes } from "node:crypto";

export const INSECURE_DEFAULT_SECRET =
  "syncspace_super_secret_development_encryption_key_2026";
export const MINIMUM_SECRET_LENGTH = 32;

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

/**
 * Ephemeral secret generated in-memory per Node process for Next.js build-phase bundling.
 * It is cryptographically random, never hardcoded, never predictable across builds,
 * and cannot be used for persistent authentication at runtime.
 */
let memoizedEphemeralBuildSecret: string | null = null;

export function getEphemeralBuildSecret(): string {
  if (!memoizedEphemeralBuildSecret) {
    memoizedEphemeralBuildSecret = `ephemeral_build_${randomBytes(32).toString("hex")}`;
  }
  return memoizedEphemeralBuildSecret;
}

/**
 * Resets the memoized ephemeral build-phase secret (for testing).
 */
export function _resetEphemeralBuildSecretForTesting(): void {
  memoizedEphemeralBuildSecret = null;
}

/**
 * Checks whether a candidate secret matches known placeholders or default development values.
 */
export function isPlaceholderSecret(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed.length === 0 ||
    trimmed === INSECURE_DEFAULT_SECRET.toLowerCase() ||
    trimmed.startsWith("placeholder") ||
    trimmed.startsWith("changeme") ||
    trimmed.startsWith("your-") ||
    trimmed.startsWith("your_") ||
    trimmed.startsWith("ephemeral_build_")
  );
}

/**
 * Resolves and validates the Better Auth encryption secret for the current environment.
 *
 * Rules:
 * 1. In production build phase (NEXT_PHASE === "phase-production-build"):
 *    - ALWAYS returns a cryptographically random, in-memory ephemeral secret.
 *    - Even if BETTER_AUTH_SECRET is configured in the environment, it is never used.
 *    - This completely isolates real production secrets from build artifacts, traces,
 *      and memory space of the build process.
 * 2. In production runtime (NODE_ENV === "production" and NEXT_PHASE !== "phase-production-build"):
 *    - BETTER_AUTH_SECRET MUST be set in environment variables.
 *    - It CANNOT be the hardcoded development secret.
 *    - It CANNOT be a placeholder or an ephemeral build secret.
 *    - It MUST be at least 32 characters in length.
 *    - Violation throws an AuthConfigurationError and aborts execution.
 * 3. In non-production (development, test):
 *    - If BETTER_AUTH_SECRET is provided, it is used.
 *    - If absent, a development-only fallback key is used so local setup and vitest run smoothly.
 */
export function resolveAuthSecret(
  env: NodeJS.ProcessEnv = process.env
): string {
  // During build phase, unconditionally return ephemeral build secret without accessing BETTER_AUTH_SECRET
  if (env.NEXT_PHASE === "phase-production-build") {
    return getEphemeralBuildSecret();
  }

  const secret = env.BETTER_AUTH_SECRET?.trim();
  const isProduction = env.NODE_ENV === "production";

  if (isProduction) {
    if (!secret) {
      throw new AuthConfigurationError(
        "[Security Configuration Error] Missing required environment variable BETTER_AUTH_SECRET in production. " +
          "You must generate and configure a cryptographically strong secret (minimum 32 characters, e.g. 'openssl rand -base64 32')."
      );
    }

    if (secret === INSECURE_DEFAULT_SECRET || isPlaceholderSecret(secret)) {
      throw new AuthConfigurationError(
        "[Security Configuration Error] Insecure or placeholder BETTER_AUTH_SECRET detected in production. " +
          "Hardcoded, public, or placeholder secrets are strictly forbidden in production. " +
          "Generate a secure secret using 'openssl rand -base64 32' and set it in your environment."
      );
    }

    if (secret.length < MINIMUM_SECRET_LENGTH) {
      throw new AuthConfigurationError(
        `[Security Configuration Error] BETTER_AUTH_SECRET in production must be at least ${MINIMUM_SECRET_LENGTH} characters long (got ${secret.length} characters).`
      );
    }

    return secret;
  }

  // Non-production (development / test)
  if (secret) {
    return secret;
  }

  return "syncspace_local_dev_fallback_secret_min_32_chars_long_not_for_prod";
}
