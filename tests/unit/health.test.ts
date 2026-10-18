import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/prisma";
import {
  InMemoryStorageProvider,
  setStorageProviderForTests,
  resetStorageProviderForTests,
  StorageConfigurationError,
} from "@/lib/storage";

describe("Phase I.1 — Production Readiness Health Check API (/api/health)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetStorageProviderForTests();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetStorageProviderForTests();
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
  });

  it("returns 200 healthy when all dependencies are ready", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    setStorageProviderForTests(mockStorage);
    process.env.LIVEBLOCKS_SECRET_KEY = "sk_prod_valid_test_secret_key_12345";

    const response = await GET();
    expect(response.status).toBe(200);

    const headers = response.headers;
    expect(headers.get("Cache-Control")).toContain("no-store");

    const body = await response.json();
    expect(body.status).toBe("healthy");
    expect(body).toHaveProperty("timestamp");
    expect(body.services.database.status).toBe("up");
    expect(typeof body.services.database.latencyMs).toBe("number");
    expect(body.services.storage.status).toBe("ready");
    expect(body.services.collaboration.status).toBe("ready");
  });

  it("handles database failure by returning 503 unhealthy with sanitized response", async () => {
    const rawSensitiveError =
      "FATAL: password authentication failed for user 'syncspace_admin' at postgres://10.0.4.12:5432/syncspace_prod";
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error(rawSensitiveError));
    const mockStorage = new InMemoryStorageProvider();
    setStorageProviderForTests(mockStorage);
    process.env.LIVEBLOCKS_SECRET_KEY = "sk_prod_valid_test_secret_key_12345";

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.services.database.status).toBe("down");

    // Must never leak raw database error, connection string, or IP
    expect(body.services.database).not.toHaveProperty("error");
    const jsonString = JSON.stringify(body);
    expect(jsonString).not.toContain("password");
    expect(jsonString).not.toContain("10.0.4.12");
    expect(jsonString).not.toContain("syncspace_admin");
    expect(jsonString).not.toContain("FATAL");
  });

  it("handles missing storage configuration by returning 503 unhealthy", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);

    // Mock storage resolution throwing configuration error
    const storageModule = await import("@/lib/storage");
    vi.spyOn(storageModule, "getStorageProvider").mockImplementationOnce(() => {
      throw new StorageConfigurationError("Missing S3_BUCKET_NAME in production.");
    });

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.services.storage.status).toBe("unconfigured");
  });

  it("handles storage access failure by returning 503 unhealthy", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    mockStorage.setFailNextHead(true);
    setStorageProviderForTests(mockStorage);
    process.env.LIVEBLOCKS_SECRET_KEY = "sk_prod_valid_test_secret_key_12345";

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.services.storage.status).toBe("error");
  });

  it("handles missing Liveblocks configuration: 503 in production vs 200 degraded in non-production", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    setStorageProviderForTests(mockStorage);

    delete process.env.LIVEBLOCKS_SECRET_KEY;

    // Test in strict production mode
    process.env.SYNCSPACE_STRICT_PRODUCTION = "true";
    const prodResponse = await GET();
    expect(prodResponse.status).toBe(503);

    const prodBody = await prodResponse.json();
    expect(prodBody.status).toBe("unhealthy");
    expect(prodBody.services.collaboration.status).toBe("unconfigured");

    // Test in non-production mode
    process.env.SYNCSPACE_STRICT_PRODUCTION = "false";
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);

    const devResponse = await GET();
    expect(devResponse.status).toBe(200);

    const devBody = await devResponse.json();
    expect(devBody.status).toBe("degraded");
    expect(devBody.services.collaboration.status).toBe("unconfigured");
  });

  it("enforces strict response sanitization and avoids leaking internal details", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    setStorageProviderForTests(mockStorage);
    process.env.LIVEBLOCKS_SECRET_KEY = "sk_prod_valid_test_secret_key_12345";
    vi.stubEnv("NODE_ENV", "production");

    const response = await GET();
    const body = await response.json();

    // Verify no internal environment details or uptime are exposed
    expect(body).not.toHaveProperty("environment");
    expect(body).not.toHaveProperty("uptimeSeconds");
    expect(body).not.toHaveProperty("durationMs");

    // Verify storage does not leak provider class/driver name
    expect(body.services.storage).not.toHaveProperty("provider");
    expect(body.services.storage).toEqual({ status: "ready" });

    // Verify collaboration does not leak internal key fragments
    expect(body.services.collaboration).toEqual({ status: "ready" });
  });
});
