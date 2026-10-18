import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getStorageProvider,
  checkStorageConnectivity,
  StorageConfigurationError,
} from "@/lib/storage";
import { isLiveblocksSecretKeyConfigured } from "@/services/liveblocks-auth.service";

export const dynamic = "force-dynamic";

/**
 * SyncSpace Production Readiness Health Check Probe
 *
 * GET /api/health
 *
 * CONTRACT & SEMANTICS:
 * - Readiness check: Evaluates whether the application is fully ready to accept and process traffic.
 * - Dependencies evaluated:
 *   1. Relational Database (PostgreSQL via Prisma SELECT 1)
 *   2. Object Storage (Active provider configuration & non-destructive connectivity probe)
 *   3. Real-Time Collaboration (Liveblocks credentials validation)
 *
 * RESPONSE CODES:
 * - 200 OK:
 *   - "healthy": All required dependencies are reachable and operational.
 *   - "degraded" (Non-production only): Database and storage are ready, but Liveblocks
 *     is unconfigured (supported in local development mock mode).
 * - 503 Service Unavailable:
 *   - "unhealthy": Any required production dependency is unavailable or misconfigured.
 *     In production, database, storage, and Liveblocks are all mandatory.
 *
 * SANITIZATION:
 * - Never returns raw database error messages, stack traces, hostnames, ports, internal paths,
 *   connection strings, bucket names, credentials, internal provider names, or environment labels.
 */
export async function GET() {
  const isProduction =
    process.env.SYNCSPACE_STRICT_PRODUCTION === "true" ||
    (process.env.NODE_ENV === "production" &&
      !process.env.NEXT_PUBLIC_APP_URL?.startsWith("http://localhost:") &&
      !process.env.BETTER_AUTH_URL?.startsWith("http://localhost:"));

  // 1. Database readiness check
  let dbStatus: "up" | "down" = "down";
  let dbLatencyMs: number | undefined;

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = "up";
  } catch {
    dbStatus = "down";
  }

  // 2. Storage readiness check
  let storageStatus: "ready" | "unconfigured" | "error" = "unconfigured";
  try {
    const provider = getStorageProvider();
    const probe = await checkStorageConnectivity(provider, 3000);
    storageStatus = probe.reachable ? "ready" : "error";
  } catch (err: unknown) {
    if (err instanceof StorageConfigurationError) {
      storageStatus = "unconfigured";
    } else {
      storageStatus = "error";
    }
  }

  // 3. Real-time collaboration readiness check
  const liveblocksConfigured = isLiveblocksSecretKeyConfigured();
  const collaborationStatus: "ready" | "unconfigured" = liveblocksConfigured
    ? "ready"
    : "unconfigured";

  // Evaluate readiness status and HTTP status code
  let overallStatus: "healthy" | "degraded" | "unhealthy";
  let httpStatusCode: number;

  const isDbReady = dbStatus === "up";
  const isStorageReady = storageStatus === "ready";
  const isCollabReady = collaborationStatus === "ready";

  if (!isDbReady || !isStorageReady) {
    overallStatus = "unhealthy";
    httpStatusCode = 503;
  } else if (!isCollabReady) {
    if (isProduction) {
      // Liveblocks is a required dependency in production
      overallStatus = "unhealthy";
      httpStatusCode = 503;
    } else {
      // In development/test environments, mock mode is tolerated as degraded
      overallStatus = "degraded";
      httpStatusCode = 200;
    }
  } else {
    overallStatus = "healthy";
    httpStatusCode = 200;
  }

  const responseBody = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: {
      database: {
        status: dbStatus,
        ...(typeof dbLatencyMs === "number" ? { latencyMs: dbLatencyMs } : {}),
      },
      storage: {
        status: storageStatus,
      },
      collaboration: {
        status: collaborationStatus,
      },
    },
  };

  return NextResponse.json(responseBody, {
    status: httpStatusCode,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
