import "dotenv/config";
import { defineConfig } from "prisma/config";
import { isProductionEnvironment } from "./src/lib/readiness";

function isPlaceholderUrl(val?: string): boolean {
  if (!val) return true;
  const lower = val.trim().toLowerCase();
  return (
    lower.includes("placeholder") ||
    lower.includes("example") ||
    lower.includes("changeme") ||
    lower.includes("your-") ||
    lower === "dummy"
  );
}

/**
 * Resolves the database connection string for Prisma CLI operations (migrations, status, client generation).
 *
 * CONTRACT & PRECEDENCE:
 * 1. DIRECT_URL: Direct unpooled connection to PostgreSQL, required for schema migrations and DDL locks
 *    (e.g., Neon direct unpooled endpoint).
 * 2. DATABASE_URL: Connection-pooled URL, used as fallback for local dev and single-connection setups.
 * 3. Client generation: Safe placeholder string during build/generate when no live connection is needed.
 * 4. Production guard: In production, missing database configuration strictly fails closed with an error
 *    to prevent migration commands from accidentally targeting a localhost database.
 * 5. Local development fallback: Local Docker PostgreSQL connection.
 */
export function getPrismaCliDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
  options?: { isClientGeneration?: boolean }
): string {
  // 1. Prefer DIRECT_URL when explicitly configured
  const directUrl = env.DIRECT_URL?.trim();
  if (directUrl && !isPlaceholderUrl(directUrl)) {
    return directUrl;
  }

  // 2. Fall back to DATABASE_URL if configured
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl && !isPlaceholderUrl(databaseUrl)) {
    return databaseUrl;
  }

  // 3. Client generation (e.g. npx prisma generate during build) does not need a live database
  const isGenerate =
    options?.isClientGeneration ??
    (Boolean(process.argv?.some((arg) => arg.includes("generate"))) ||
      env.NEXT_PHASE === "phase-production-build");

  if (isGenerate) {
    return "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  }

  // 4. In production environments, missing database configuration for migrations must fail closed
  if (isProductionEnvironment(env)) {
    throw new Error(
      "[Security Configuration Error] Missing required database configuration for migrations in production. Specify DIRECT_URL or DATABASE_URL."
    );
  }

  // 5. Default local development connection
  return "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public";
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: getPrismaCliDatabaseUrl(),
  },
});
