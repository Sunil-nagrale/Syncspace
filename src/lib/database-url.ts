import { isProductionEnvironment } from "./readiness";

/**
 * Extracts the database hostname from a PostgreSQL connection string.
 * Supports standard URLs, IPv6 bracketed hosts ([::1]), and fallback regex for special characters.
 */
export function extractDatabaseHostname(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname;
    return host ? host.replace(/^\[|\]$/g, "").toLowerCase() : null;
  } catch {
    // Fallback extraction between '@' and port/path/query
    const match = trimmed.match(/@([^/:?#]+)/);
    if (match && match[1]) {
      return match[1].replace(/^\[|\]$/g, "").toLowerCase();
    }
    // If no '@', check if host is right after protocol (e.g. postgresql://localhost/...)
    const protoMatch = trimmed.match(/^[a-z]+:\/\/([^/@:?#]+)/i);
    if (protoMatch && protoMatch[1]) {
      return protoMatch[1].replace(/^\[|\]$/g, "").toLowerCase();
    }
    return null;
  }
}

/**
 * Determines whether a given database host is a loopback or local-only address.
 * Matches:
 * - localhost and *.localhost
 * - 127.0.0.1 and the 127.0.0.0/8 loopback subnet
 * - ::1 (IPv6 loopback)
 * - 0.0.0.0 and :: (unspecified addresses)
 */
export function isLoopbackHost(hostname: string | null): boolean {
  if (!hostname) return false;
  const clean = hostname.replace(/^\[|\]$/g, "").toLowerCase().trim();
  return (
    clean === "localhost" ||
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean === "0.0.0.0" ||
    clean === "::" ||
    clean.startsWith("127.") ||
    clean.endsWith(".localhost")
  );
}

/**
 * Checks whether a database URL contains template placeholders or example credentials.
 * Matches:
 * - Obvious template tokens: "placeholder", "example", "changeme", "your-", "dummy", "sample"
 * - Example credential pairs: "user:password", "username:password", "user:pass"
 */
export function isTemplateOrPlaceholderUrl(val?: string): boolean {
  if (!val) return true;
  const lower = val.trim().toLowerCase();
  return (
    lower.includes("placeholder") ||
    lower.includes("example") ||
    lower.includes("changeme") ||
    lower.includes("your-") ||
    lower.includes("dummy") ||
    lower.includes("user:password") ||
    lower.includes("username:password") ||
    lower.includes("user:pass")
  );
}

/**
 * Validates that a database connection URL is safe for production use.
 * Strictly rejects:
 * - Missing or empty URLs
 * - Example or template credentials (e.g. user:password, placeholder, changeme)
 * - Loopback addresses (localhost, 127.0.0.1, ::1)
 *
 * Throws non-sensitive errors that NEVER print the database URL, password, or host.
 */
export function validateProductionDatabaseUrl(
  url: string | undefined,
  varName: "DATABASE_URL" | "DIRECT_URL" | string
): string {
  if (!url || !url.trim()) {
    throw new Error(
      `[Security Configuration Error] Missing required database configuration for ${varName} in production.`
    );
  }

  const trimmed = url.trim();

  if (isTemplateOrPlaceholderUrl(trimmed)) {
    throw new Error(
      `[Security Configuration Error] Insecure or placeholder ${varName} detected in production. Template credentials and example values are not permitted.`
    );
  }

  const hostname = extractDatabaseHostname(trimmed);
  if (hostname && isLoopbackHost(hostname)) {
    throw new Error(
      `[Security Configuration Error] Insecure ${varName} detected in production. Loopback and local addresses are not permitted in production environments.`
    );
  }

  return trimmed;
}

/**
 * Detects whether the current CLI invocation is an actual Prisma `generate` command.
 *
 * Requirements:
 * - Slices off executable and script paths to avoid false positives on directory paths containing 'generate'.
 * - Checks for the exact 'generate' command token.
 * - Ensures database migration commands ('migrate', 'db') are not misclassified as generation commands.
 */
export function isPrismaGenerateCommand(
  argv: string[] = process.argv ?? []
): boolean {
  if (!Array.isArray(argv) || argv.length === 0) return false;

  // If full process.argv (>= 2 elements starting with node or script), slice off runtime and script
  const isFullProcessArgv =
    argv.length >= 2 &&
    (/(^|[/\\])(node|bun)(\.exe)?$/i.test(argv[0]) ||
      /\.(js|ts|mjs|cjs)$/i.test(argv[1]));

  const cliArgs = isFullProcessArgv ? argv.slice(2) : argv;

  const hasExactGenerate = cliArgs.some((arg) => arg === "generate");
  const hasDbOrMigrateCommand = cliArgs.some(
    (arg) => arg === "migrate" || arg === "db"
  );

  return hasExactGenerate && !hasDbOrMigrateCommand;
}

export interface PrismaCliOptions {
  isClientGeneration?: boolean;
  argv?: string[];
}

/**
 * Resolves the database connection string for Prisma CLI operations (migrations, status, client generation).
 *
 * PRECEDENCE & SECURITY CONTRACT:
 * 1. Build-time client generation: Safe placeholder string returned when `prisma generate` is called or
 *    `NEXT_PHASE=phase-production-build`. No database credentials needed.
 * 2. Production mode (`isProductionEnvironment(env)`):
 *    - Validates DIRECT_URL (preferred for migrations) and rejects placeholders, template credentials, and loopback hosts.
 *    - Falls back to DATABASE_URL if DIRECT_URL is omitted, and validates it with the same production guards.
 *    - Fails closed with [Security Configuration Error] if neither is configured or if either is insecure.
 * 3. Non-production mode (development & test):
 *    - Uses DIRECT_URL if provided and non-placeholder.
 *    - Falls back to DATABASE_URL if provided and non-placeholder.
 *    - Defaults to local Docker PostgreSQL connection (`localhost:5432`).
 */
export function getPrismaCliDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
  options?: PrismaCliOptions
): string {
  // 1. Client generation does not need a live database
  const isGenerate =
    options?.isClientGeneration ??
    (isPrismaGenerateCommand(options?.argv ?? process.argv) ||
      env.NEXT_PHASE === "phase-production-build");

  if (isGenerate) {
    return "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  }

  const isProd = isProductionEnvironment(env);

  if (isProd) {
    const directUrl = env.DIRECT_URL?.trim();
    if (directUrl) {
      return validateProductionDatabaseUrl(directUrl, "DIRECT_URL");
    }

    const databaseUrl = env.DATABASE_URL?.trim();
    if (databaseUrl) {
      return validateProductionDatabaseUrl(databaseUrl, "DATABASE_URL");
    }

    throw new Error(
      "[Security Configuration Error] Missing required database configuration for migrations in production. Specify DIRECT_URL or DATABASE_URL."
    );
  }

  // Non-production (local development and test)
  const directUrl = env.DIRECT_URL?.trim();
  if (directUrl && !isTemplateOrPlaceholderUrl(directUrl)) {
    return directUrl;
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl && !isTemplateOrPlaceholderUrl(databaseUrl)) {
    return databaseUrl;
  }

  return "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public";
}

/**
 * Resolves the database connection string for application runtime queries.
 *
 * ARCHITECTURAL CONTRACT:
 * - Application runtime strictly uses `DATABASE_URL` (the connection-pooled endpoint, e.g. Neon connection pooler).
 * - `DIRECT_URL` is reserved EXCLUSIVELY for Prisma CLI schema migrations and status checks in `prisma.config.ts`.
 *   Runtime queries must NEVER use `DIRECT_URL`, as serverless traffic requires pooled connection management.
 * - In production, validates that `DATABASE_URL` is non-empty, not a placeholder, and not a loopback address.
 * - Localhost and template credentials are strictly rejected in production runtime.
 */
export function getDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  if (env.NEXT_PHASE === "phase-production-build") {
    if (env.DATABASE_URL) {
      return env.DATABASE_URL;
    }
    return "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public";
  }

  if (isProductionEnvironment(env)) {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new Error(
        "[Security Configuration Error] Missing required environment variable DATABASE_URL in production."
      );
    }
    return validateProductionDatabaseUrl(databaseUrl, "DATABASE_URL");
  }

  if (env.DATABASE_URL?.trim()) {
    return env.DATABASE_URL.trim();
  }
  return "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public";
}
