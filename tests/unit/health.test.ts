import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/health/route";
import { isProductionEnvironment } from "@/lib/readiness";
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

  describe("Phase I.3 — Enforce Explicit Production Readiness", () => {
    it("treats NODE_ENV=production as production by default despite localhost URLs and returns 503 when Liveblocks is missing", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
      const mockStorage = new InMemoryStorageProvider();
      await mockStorage.putObject({
        storageKey: HEALTH_CHECK_PROBE_KEY,
        bytes: new Uint8Array([1]),
        contentType: "text/plain",
      });
      setStorageProviderForTests(mockStorage);

      delete process.env.LIVEBLOCKS_SECRET_KEY;
      delete process.env.SYNCSPACE_STRICT_PRODUCTION;
      delete process.env.SYNCSPACE_TEST_LOCAL_MODE;
      delete process.env.ALLOW_LOCAL_STORAGE_IN_TEST;

      // Simulate production runtime with localhost URLs
      vi.stubEnv("NODE_ENV", "production");
      process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
      process.env.BETTER_AUTH_URL = "http://localhost:3000";

      expect(isProductionEnvironment(process.env)).toBe(true);

      const response = await GET();
      expect(response.status).toBe(503);

      const body = await response.json();
      expect(body.status).toBe("unhealthy");
      expect(body.services.database.status).toBe("up");
      expect(body.services.storage.status).toBe("ready");
      expect(body.services.collaboration.status).toBe("unconfigured");
    });

    it("allows explicit test-only opt-in flag to permit degraded mode when Liveblocks is missing during local E2E testing", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
      const mockStorage = new InMemoryStorageProvider();
      await mockStorage.putObject({
        storageKey: HEALTH_CHECK_PROBE_KEY,
        bytes: new Uint8Array([1]),
        contentType: "text/plain",
      });
      setStorageProviderForTests(mockStorage);

      delete process.env.LIVEBLOCKS_SECRET_KEY;
      vi.stubEnv("NODE_ENV", "production");
      process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
      process.env.BETTER_AUTH_URL = "http://localhost:3000";

      // With explicit test-only opt-in flag SYNCSPACE_TEST_LOCAL_MODE
      process.env.SYNCSPACE_TEST_LOCAL_MODE = "true";
      expect(isProductionEnvironment(process.env)).toBe(false);

      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("degraded");
      expect(body.services.collaboration.status).toBe("unconfigured");
      expect(body.services.storage.status).toBe("ready");

      // Also verify ALLOW_LOCAL_STORAGE_IN_TEST works as alias
      delete process.env.SYNCSPACE_TEST_LOCAL_MODE;
      process.env.ALLOW_LOCAL_STORAGE_IN_TEST = "true";
      expect(isProductionEnvironment(process.env)).toBe(false);

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
      const response2 = await GET();
      expect(response2.status).toBe(200);
      const body2 = await response2.json();
      expect(body2.status).toBe("degraded");

      // Verify that SYNCSPACE_STRICT_PRODUCTION overrides any test flag
      process.env.SYNCSPACE_STRICT_PRODUCTION = "true";
      expect(isProductionEnvironment(process.env)).toBe(true);

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
      const response3 = await GET();
      expect(response3.status).toBe(503);
      const body3 = await response3.json();
      expect(body3.status).toBe("unhealthy");
    });

    it("ensures missing or invalid storage remains unhealthy (503) even with test opt-in active", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
      const mockStorage = new InMemoryStorageProvider();
      // Do not seed marker object -> storage check fails
      setStorageProviderForTests(mockStorage);

      process.env.SYNCSPACE_TEST_LOCAL_MODE = "true";
      process.env.LIVEBLOCKS_SECRET_KEY = "sk_prod_valid_test_secret_key_12345";
      vi.stubEnv("NODE_ENV", "production");

      const response = await GET();
      expect(response.status).toBe(503);

      const body = await response.json();
      expect(body.status).toBe("unhealthy");
      expect(body.services.storage.status).toBe("error");
    });

    it("supports local development with local storage and degraded mode when Liveblocks is unconfigured", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
      const mockStorage = new InMemoryStorageProvider();
      await mockStorage.putObject({
        storageKey: HEALTH_CHECK_PROBE_KEY,
        bytes: new Uint8Array([1]),
        contentType: "text/plain",
      });
      setStorageProviderForTests(mockStorage);

      delete process.env.LIVEBLOCKS_SECRET_KEY;
      vi.stubEnv("NODE_ENV", "development");

      expect(isProductionEnvironment(process.env)).toBe(false);

      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("degraded");
      expect(body.services.collaboration.status).toBe("unconfigured");
      expect(body.services.storage.status).toBe("ready");
    });

    it("evaluates isProductionEnvironment helper across all environment combinations", () => {
      // Default production
      expect(isProductionEnvironment({ NODE_ENV: "production" })).toBe(true);

      // Production with localhost URLs remains production!
      expect(
        isProductionEnvironment({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "http://localhost:3000",
          BETTER_AUTH_URL: "http://localhost:3000",
        })
      ).toBe(true);

      // Strict production flag unconditionally enforces production
      expect(
        isProductionEnvironment({
          NODE_ENV: "development",
          SYNCSPACE_STRICT_PRODUCTION: "true",
        })
      ).toBe(true);

      // Test opt-in flag enables non-production degraded mode when not strict production
      expect(
        isProductionEnvironment({
          NODE_ENV: "production",
          SYNCSPACE_TEST_LOCAL_MODE: "true",
        })
      ).toBe(false);

      // Strict production overrides test opt-in flag
      expect(
        isProductionEnvironment({
          NODE_ENV: "production",
          SYNCSPACE_TEST_LOCAL_MODE: "true",
          SYNCSPACE_STRICT_PRODUCTION: "true",
        })
      ).toBe(true);

      // Standard development
      expect(isProductionEnvironment({ NODE_ENV: "development" })).toBe(false);
      expect(isProductionEnvironment({})).toBe(false);
    });
  });
});
