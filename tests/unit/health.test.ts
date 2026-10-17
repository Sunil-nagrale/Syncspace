import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/prisma";

describe("Phase I — Production Health Check API (/api/health)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with service health status when database is reachable", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);

    const response = await GET();
    expect(response.status).toBe(200);

    const headers = response.headers;
    expect(headers.get("Cache-Control")).toContain("no-store");

    const body = await response.json();
    expect(body).toHaveProperty("status");
    expect(["healthy", "degraded"]).toContain(body.status);
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptimeSeconds");
    expect(body.services.database.status).toBe("connected");
    expect(body.services.database).toHaveProperty("latencyMs");
    expect(body.services.storage).toHaveProperty("status");
    expect(body.services.liveblocks).toHaveProperty("status");
  });

  it("returns 503 unhealthy when database query fails", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(
      new Error("Database connection pool exhausted")
    );

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.services.database.status).toBe("error");
    expect(body.services.database.error).toBe("Database connection pool exhausted");
  });
});
