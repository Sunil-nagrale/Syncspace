import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/health/route";
import {
  isProductionEnvironment,
  isDeployedPlatform,
  isLocalTestEnvironment,
} from "@/lib/readiness";
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

  describe("Phase I.4.1 — Harden Production Readiness Test Isolation", () => {
    it("NODE_ENV=production with both local-test flags and runner markers on a bare server strictly remains production", async () => {
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
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      delete process.env.AWS_EXECUTION_ENV;
      vi.stubEnv("NODE_ENV", "production");

      // Bare server (no platform env vars) where test flags and runner markers were accidentally configured
      process.env.SYNCSPACE_LOCAL_TEST_RUNNER = "true";
      process.env.PLAYWRIGHT = "1";
      process.env.SYNCSPACE_TEST_LOCAL_MODE = "true";
      process.env.ALLOW_LOCAL_STORAGE_IN_TEST = "true";
      process.env.NEXT_PUBLIC_APP_URL = "http://192.168.1.100:3000";

      expect(isDeployedPlatform(process.env)).toBe(false);
      expect(isLocalTestEnvironment(process.env)).toBe(false);
      expect(isProductionEnvironment(process.env)).toBe(true);

      // Readiness health check MUST report HTTP 503 unhealthy in production when Liveblocks is unconfigured
      const bareResponse = await GET();
      expect(bareResponse.status).toBe(503);
      const bareBody = await bareResponse.json();
      expect(bareBody.status).toBe("unhealthy");
      expect(bareBody.services.collaboration.status).toBe("unconfigured");
      expect(bareBody.services.database.status).toBe("up");
      expect(bareBody.services.storage.status).toBe("ready");
    });

    it("NODE_ENV=production with both local-test flags and runner markers on recognized deployment platforms strictly remains production", async () => {
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
      vi.stubEnv("NODE_ENV", "production");
      process.env.SYNCSPACE_LOCAL_TEST_RUNNER = "true";
      process.env.PLAYWRIGHT = "1";
      process.env.SYNCSPACE_TEST_LOCAL_MODE = "true";
      process.env.NEXT_PUBLIC_APP_URL = "https://syncspace.dev";

      // 1. On Vercel
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "production";
      expect(isDeployedPlatform(process.env)).toBe(true);
      expect(isLocalTestEnvironment(process.env)).toBe(false);
      expect(isProductionEnvironment(process.env)).toBe(true);

      const vercelResponse = await GET();
      expect(vercelResponse.status).toBe(503);
      const vercelBody = await vercelResponse.json();
      expect(vercelBody.status).toBe("unhealthy");
      expect(vercelBody.services.collaboration.status).toBe("unconfigured");

      // 2. On AWS deployment platform
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      process.env.AWS_EXECUTION_ENV = "AWS_ECS_FARGATE";
      expect(isDeployedPlatform(process.env)).toBe(true);
      expect(isLocalTestEnvironment(process.env)).toBe(false);
      expect(isProductionEnvironment(process.env)).toBe(true);

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
      const awsResponse = await GET();
      expect(awsResponse.status).toBe(503);
    });

    it("NODE_ENV=production plus localhost URLs remains production", async () => {
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
      delete process.env.SYNCSPACE_LOCAL_TEST_RUNNER;

      // Production runtime configured with localhost URLs
      vi.stubEnv("NODE_ENV", "production");
      process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
      process.env.BETTER_AUTH_URL = "http://localhost:3000";

      expect(
        isProductionEnvironment({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "http://localhost:3000",
          BETTER_AUTH_URL: "http://localhost:3000",
        })
      ).toBe(true);

      const response = await GET();
      expect(response.status).toBe(503);

      const body = await response.json();
      expect(body.status).toBe("unhealthy");
      expect(body.services.database.status).toBe("up");
      expect(body.services.storage.status).toBe("ready");
      expect(body.services.collaboration.status).toBe("unconfigured");
    });

    it("a legitimate isolated local E2E test environment (NODE_ENV=test) allows degraded/local test mode", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
      const mockStorage = new InMemoryStorageProvider();
      await mockStorage.putObject({
        storageKey: HEALTH_CHECK_PROBE_KEY,
        bytes: new Uint8Array([1]),
        contentType: "text/plain",
      });
      setStorageProviderForTests(mockStorage);

      delete process.env.LIVEBLOCKS_SECRET_KEY;
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      delete process.env.AWS_EXECUTION_ENV;
      delete process.env.SYNCSPACE_STRICT_PRODUCTION;

      // Legitimate isolated local test harness
      vi.stubEnv("NODE_ENV", "test");
      process.env.SYNCSPACE_LOCAL_TEST_RUNNER = "true";
      process.env.PLAYWRIGHT = "1";
      process.env.SYNCSPACE_TEST_LOCAL_MODE = "true";
      process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
      process.env.BETTER_AUTH_URL = "http://localhost:3000";

      expect(isDeployedPlatform(process.env)).toBe(false);
      expect(isLocalTestEnvironment(process.env)).toBe(true);
      expect(isProductionEnvironment(process.env)).toBe(false);

      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("degraded");
      expect(body.services.collaboration.status).toBe("unconfigured");
      expect(body.services.storage.status).toBe("ready");
    });

    it("ensures missing or invalid production storage remains a configuration error (503)", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ healthy: 1 }] as any);
      const mockStorage = new InMemoryStorageProvider();
      // Do not seed marker object -> storage connectivity probe fails
      setStorageProviderForTests(mockStorage);

      process.env.SYNCSPACE_LOCAL_TEST_RUNNER = "true";
      process.env.SYNCSPACE_TEST_LOCAL_MODE = "true";
      process.env.LIVEBLOCKS_SECRET_KEY = "sk_prod_valid_test_secret_key_12345";
      vi.stubEnv("NODE_ENV", "production");

      const response = await GET();
      expect(response.status).toBe(503);

      const body = await response.json();
      expect(body.status).toBe("unhealthy");
      expect(body.services.storage.status).toBe("error");
    });

    it("ensures missing required production Liveblocks configuration returns HTTP 503", async () => {
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
      process.env.VERCEL = "1";

      const response = await GET();
      expect(response.status).toBe(503);

      const body = await response.json();
      expect(body.status).toBe("unhealthy");
      expect(body.services.collaboration.status).toBe("unconfigured");
    });

    it("SYNCSPACE_STRICT_PRODUCTION=true continues to enforce strict production mode across all permutations", () => {
      // Overrides local test runner and test flags unconditionally
      expect(
        isProductionEnvironment({
          NODE_ENV: "production",
          SYNCSPACE_LOCAL_TEST_RUNNER: "true",
          SYNCSPACE_TEST_LOCAL_MODE: "true",
          SYNCSPACE_STRICT_PRODUCTION: "true",
        })
      ).toBe(true);

      // Overrides development NODE_ENV
      expect(
        isProductionEnvironment({
          NODE_ENV: "development",
          SYNCSPACE_STRICT_PRODUCTION: "true",
        })
      ).toBe(true);

      expect(
        isLocalTestEnvironment({
          SYNCSPACE_LOCAL_TEST_RUNNER: "true",
          SYNCSPACE_TEST_LOCAL_MODE: "true",
          SYNCSPACE_STRICT_PRODUCTION: "true",
        })
      ).toBe(false);
    });

    it("evaluates isDeployedPlatform, isLocalTestEnvironment, and isProductionEnvironment accurately", () => {
      // Deployed platforms
      expect(isDeployedPlatform({ VERCEL: "1" })).toBe(true);
      expect(isDeployedPlatform({ VERCEL_ENV: "production" })).toBe(true);
      expect(isDeployedPlatform({ VERCEL_ENV: "preview" })).toBe(true);
      expect(isDeployedPlatform({ AWS_EXECUTION_ENV: "AWS_ECS_FARGATE" })).toBe(true);
      expect(isDeployedPlatform({ RENDER: "true" })).toBe(true);
      expect(isDeployedPlatform({ FLY_APP_NAME: "syncspace-app" })).toBe(true);
      expect(isDeployedPlatform({})).toBe(false);

      // Local test environment requires both runner marker and opt-in flag in non-production mode, and no deployment platform
      expect(
        isLocalTestEnvironment({
          NODE_ENV: "test",
          SYNCSPACE_LOCAL_TEST_RUNNER: "true",
          SYNCSPACE_TEST_LOCAL_MODE: "true",
        })
      ).toBe(true);

      expect(
        isLocalTestEnvironment({
          NODE_ENV: "test",
          PLAYWRIGHT: "1",
          ALLOW_LOCAL_STORAGE_IN_TEST: "true",
        })
      ).toBe(true);

      // Bare production host (NODE_ENV=production) can NEVER be a local test environment
      expect(
        isLocalTestEnvironment({
          NODE_ENV: "production",
          SYNCSPACE_LOCAL_TEST_RUNNER: "true",
          SYNCSPACE_TEST_LOCAL_MODE: "true",
          PLAYWRIGHT: "1",
        })
      ).toBe(false);

      // Deployed platforms can never be local test environments
      expect(
        isLocalTestEnvironment({
          NODE_ENV: "test",
          VERCEL: "1",
          SYNCSPACE_LOCAL_TEST_RUNNER: "true",
          SYNCSPACE_TEST_LOCAL_MODE: "true",
        })
      ).toBe(false);

      // Missing runner marker fails
      expect(
        isLocalTestEnvironment({
          NODE_ENV: "test",
          SYNCSPACE_TEST_LOCAL_MODE: "true",
        })
      ).toBe(false);

      // Missing opt-in flag fails
      expect(
        isLocalTestEnvironment({
          NODE_ENV: "test",
          SYNCSPACE_LOCAL_TEST_RUNNER: "true",
        })
      ).toBe(false);
    });
  });
});
