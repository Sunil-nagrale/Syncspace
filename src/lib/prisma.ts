import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

/**
 * Resolves the database connection string for application runtime queries.
 *
 * ARCHITECTURAL CONTRACT:
 * - Application runtime strictly uses `DATABASE_URL` (the connection-pooled endpoint, e.g. Neon connection pooler).
 * - `DIRECT_URL` is reserved EXCLUSIVELY for Prisma CLI schema migrations and status checks in `prisma.config.ts`.
 *   Runtime queries must NEVER use `DIRECT_URL`, as serverless traffic requires pooled connection management.
 */
export function getDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }
  if (
    env.NODE_ENV === "production" &&
    env.NEXT_PHASE !== "phase-production-build"
  ) {
    throw new Error(
      "[Security Configuration Error] Missing required environment variable DATABASE_URL in production."
    );
  }
  return "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public";
}

const connectionString = getDatabaseUrl();

const pool =
  globalForPrisma.pool ??
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pool = pool;
}
