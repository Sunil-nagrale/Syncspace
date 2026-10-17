import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveAuthSecret,
  isPlaceholderSecret,
  AuthConfigurationError,
  INSECURE_DEFAULT_SECRET,
  MINIMUM_SECRET_LENGTH,
  _resetEphemeralBuildSecretForTesting,
} from "@/lib/auth-secret";

describe("Phase H.1 — Authentication Secret Production Hardening Tests", () => {
  const validProductionSecret =
    "c8f7d9a0e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8";

  beforeEach(() => {
    _resetEphemeralBuildSecretForTesting();
  });

  describe("1. Production Runtime Enforcement (NODE_ENV === 'production')", () => {
    it("fails fast when BETTER_AUTH_SECRET is undefined or empty", () => {
      expect(() =>
        resolveAuthSecret({
          NODE_ENV: "production",
        })
      ).toThrow(AuthConfigurationError);

      expect(() =>
        resolveAuthSecret({
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: "",
        })
      ).toThrow(AuthConfigurationError);

      expect(() =>
        resolveAuthSecret({
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: "   ",
        })
      ).toThrow("Missing required environment variable BETTER_AUTH_SECRET in production");
    });

    it("strictly rejects the hardcoded development encryption key", () => {
      expect(() =>
        resolveAuthSecret({
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: INSECURE_DEFAULT_SECRET,
        })
      ).toThrow("Insecure or placeholder BETTER_AUTH_SECRET detected in production");
    });

    it("strictly rejects placeholder strings from template files", () => {
      const placeholders = [
        "placeholder_auth_secret_minimum_32_characters_for_jwt_and_cookies",
        "placeholder_secret",
        "changeme_please_set_a_real_secret_here_32chars",
        "your-secret-key-goes-here-minimum-32-chars-long",
      ];

      for (const ph of placeholders) {
        expect(() =>
          resolveAuthSecret({
            NODE_ENV: "production",
            BETTER_AUTH_SECRET: ph,
          })
        ).toThrow("Insecure or placeholder BETTER_AUTH_SECRET detected in production");
      }
    });

    it("rejects secrets shorter than 32 characters", () => {
      expect(() =>
        resolveAuthSecret({
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: "too_short_secret_25_chars",
        })
      ).toThrow(`must be at least ${MINIMUM_SECRET_LENGTH} characters long`);
    });

    it("strictly rejects an ephemeral build secret passed as BETTER_AUTH_SECRET at production runtime", () => {
      const ephemeralSecret =
        "ephemeral_build_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      expect(() =>
        resolveAuthSecret({
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: ephemeralSecret,
        })
      ).toThrow("Insecure or placeholder BETTER_AUTH_SECRET detected in production");
    });

    it("accepts strong, unpredictable secrets in production runtime", () => {
      const resolved = resolveAuthSecret({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: validProductionSecret,
      });

      expect(resolved).toBe(validProductionSecret);
      expect(resolved.startsWith("ephemeral_build_")).toBe(false);
    });
  });

  describe("2. Build Phase Behavior (NEXT_PHASE === 'phase-production-build')", () => {
    it("provides a genuinely random ephemeral build-phase secret when building without production secrets", () => {
      const buildSecret1 = resolveAuthSecret({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      });

      expect(buildSecret1).toBeDefined();
      expect(buildSecret1.length).toBeGreaterThanOrEqual(MINIMUM_SECRET_LENGTH);
      expect(buildSecret1.startsWith("ephemeral_build_")).toBe(true);
      expect(buildSecret1).not.toBe("ephemeral_build_phase_secret_minimum_32_characters_not_for_runtime");
      expect(buildSecret1).not.toBe(INSECURE_DEFAULT_SECRET);

      // Memoized within the same process build run
      const buildSecret2 = resolveAuthSecret({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      });
      expect(buildSecret2).toBe(buildSecret1);

      // Produces a fresh distinct unguessable secret across different build runs
      _resetEphemeralBuildSecretForTesting();
      const buildSecret3 = resolveAuthSecret({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      });
      expect(buildSecret3).not.toBe(buildSecret1);
      expect(buildSecret3.startsWith("ephemeral_build_")).toBe(true);
    });

    it("always uses an ephemeral secret during build phase, even when a valid production secret is configured", () => {
      const buildSecret = resolveAuthSecret({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
        BETTER_AUTH_SECRET: validProductionSecret,
      });

      expect(buildSecret).not.toBe(validProductionSecret);
      expect(buildSecret.startsWith("ephemeral_build_")).toBe(true);
      expect(buildSecret.length).toBeGreaterThanOrEqual(MINIMUM_SECRET_LENGTH);
    });

    it("strictly isolates build phase even in non-production environments", () => {
      const buildSecret = resolveAuthSecret({
        NODE_ENV: "development",
        NEXT_PHASE: "phase-production-build",
        BETTER_AUTH_SECRET: "some_development_secret_min_32_chars_long",
      });

      expect(buildSecret.startsWith("ephemeral_build_")).toBe(true);
    });

    it("does not access BETTER_AUTH_SECRET property at all during build phase", () => {
      const throwingEnv = {
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
        get BETTER_AUTH_SECRET(): string {
          throw new Error("BETTER_AUTH_SECRET was accessed during build phase!");
        },
      } as unknown as NodeJS.ProcessEnv;

      let buildSecret: string | undefined;
      expect(() => {
        buildSecret = resolveAuthSecret(throwingEnv);
      }).not.toThrow();
      expect(buildSecret).toBeDefined();
      expect(buildSecret!.startsWith("ephemeral_build_")).toBe(true);
    });
  });

  describe("3. Development & Testing Ergonomics (NODE_ENV !== 'production')", () => {
    it("uses provided BETTER_AUTH_SECRET in development/test", () => {
      const devSecret = "custom_local_dev_secret_for_local_debugging_32chars";
      const resolved = resolveAuthSecret({
        NODE_ENV: "development",
        BETTER_AUTH_SECRET: devSecret,
      });

      expect(resolved).toBe(devSecret);
    });

    it("provides safe development fallback when BETTER_AUTH_SECRET is omitted in non-production", () => {
      const resolved = resolveAuthSecret({
        NODE_ENV: "development",
      });

      expect(resolved).toBeDefined();
      expect(resolved.length).toBeGreaterThanOrEqual(MINIMUM_SECRET_LENGTH);
      expect(resolved).not.toBe(INSECURE_DEFAULT_SECRET);
    });
  });

  describe("4. Placeholder Detection Utility", () => {
    it("correctly identifies placeholders vs real keys", () => {
      expect(isPlaceholderSecret(undefined)).toBe(true);
      expect(isPlaceholderSecret("")).toBe(true);
      expect(isPlaceholderSecret("placeholder_xyz")).toBe(true);
      expect(isPlaceholderSecret("changeme")).toBe(true);
      expect(isPlaceholderSecret("your-bucket-or-key")).toBe(true);
      expect(isPlaceholderSecret(INSECURE_DEFAULT_SECRET)).toBe(true);
      expect(isPlaceholderSecret("ephemeral_build_0123456789abcdef")).toBe(true);

      expect(isPlaceholderSecret(validProductionSecret)).toBe(false);
      expect(isPlaceholderSecret("Kj8#vL9$mQ2!zR5*tY7@wP1&sX4^uN6~")).toBe(false);
    });
  });
});
