import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveStorageProviderFromEnv } from "@/lib/storage";
import { isLiveblocksSecretKeyConfigured } from "@/services/liveblocks-auth.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const startTime = Date.now();
  let dbStatus: "connected" | "error" = "connected";
  let dbLatencyMs = 0;
  let dbErrorMessage: string | undefined;

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
  } catch (error: unknown) {
    dbStatus = "error";
    dbErrorMessage = error instanceof Error ? error.message : "Database ping failed";
  }

  let storageStatus: "ready" | "unconfigured" | "error" = "ready";
  let storageProviderName: string = "unknown";
  try {
    const provider = resolveStorageProviderFromEnv();
    storageProviderName = provider.providerName;
  } catch {
    storageStatus = "unconfigured";
  }

  const liveblocksConfigured = isLiveblocksSecretKeyConfigured();

  const isHealthy = dbStatus === "connected";
  const overallStatus = isHealthy
    ? storageStatus === "ready" && liveblocksConfigured
      ? "healthy"
      : "degraded"
    : "unhealthy";

  const responseBody = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    uptimeSeconds: Math.floor(process.uptime()),
    durationMs: Date.now() - startTime,
    services: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        ...(dbErrorMessage ? { error: dbErrorMessage } : {}),
      },
      storage: {
        status: storageStatus,
        provider: storageProviderName,
      },
      liveblocks: {
        status: liveblocksConfigured ? "configured" : "degraded_mock_mode",
      },
    },
  };

  return NextResponse.json(responseBody, {
    status: isHealthy ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
