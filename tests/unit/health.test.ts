import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/prisma";
import {
  InMemoryStorageProvider,
  setStorageProviderForTests,
  resetStorageProviderForTests,
  StorageConfigurationError,
  HEALTH_CHECK_PROBE_KEY,
} from "@/lib/storage";

describe("Phase I.2 — Production Readiness Health Check API (/api/health)", () => {
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

  it("returns 200 healthy when all dependencies are ready and health marker exists", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    await mockStorage.putObject({
      storageKey: HEALTH_CHECK_PROBE_KEY,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "text/plain",
    });
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
    expect(body.services.collaboration.status).toBe("configured");
  });

  it("handles missing probe marker object by returning 503 unhealthy", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    // Do not seed HEALTH_CHECK_PROBE_KEY in store; simulates missing probe object (404)
    setStorageProviderForTests(mockStorage);
    process.env.LIVEBLOCKS_SECRET_KEY = "sk_prod_valid_test_secret_key_12345";

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.services.storage.status).toBe("error");
  });

  it("handles access-denied responses by returning 503 unhealthy without mistaking 403 for healthy", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    // Simulate S3 403 Forbidden / Access Denied
    mockStorage.setFailNextHead(true);
    setStorageProviderForTests(mockStorage);
    process.env.LIVEBLOCKS_SECRET_KEY = "sk_prod_valid_test_secret_key_12345";

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.services.storage.status).toBe("error");
  });

  it("handles storage probe timeouts by returning 503 unhealthy", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    await mockStorage.putObject({
      storageKey: HEALTH_CHECK_PROBE_KEY,
      bytes: new Uint8Array([1]),
      contentType: "text/plain",
    });
    setStorageProviderForTests(mockStorage);
    process.env.LIVEBLOCKS_SECRET_KEY = "sk_prod_valid_test_secret_key_12345";

    // Mock storage connectivity check timing out
    const storageModule = await import("@/lib/storage");
    vi.spyOn(storageModule, "checkStorageConnectivity").mockResolvedValueOnce({
      reachable: false,
    });

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.services.storage.status).toBe("error");
  });

  it("handles database failure by returning 503 unhealthy with sanitized response", async () => {
    const rawSensitiveError =
      "FATAL: password authentication failed for user 'syncspace_admin' at postgres://10.0.4.12:5432/syncspace_prod";
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error(rawSensitiveError));
    const mockStorage = new InMemoryStorageProvider();
    await mockStorage.putObject({
      storageKey: HEALTH_CHECK_PROBE_KEY,
      bytes: new Uint8Array([1]),
      contentType: "text/plain",
    });
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

  it("handles missing Liveblocks configuration: 503 in production vs 200 degraded in non-production", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    await mockStorage.putObject({
      storageKey: HEALTH_CHECK_PROBE_KEY,
      bytes: new Uint8Array([1]),
      contentType: "text/plain",
    });
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

  it("enforces strict response sanitization across all responses", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
    const mockStorage = new InMemoryStorageProvider();
    await mockStorage.putObject({
      storageKey: HEALTH_CHECK_PROBE_KEY,
      bytes: new Uint8Array([1]),
      contentType: "text/plain",
    });
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

    // Verify collaboration accurately describes configuration status without claiming connectivity
    expect(body.services.collaboration).toEqual({ status: "configured" });
  });
});
