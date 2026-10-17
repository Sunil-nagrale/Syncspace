import { describe, it, expect } from "vitest";
import {
  resolveAuthSecret,
  isPlaceholderSecret,
  AuthConfigurationError,
  INSECURE_DEFAULT_SECRET,
  MINIMUM_SECRET_LENGTH,
} from "@/lib/auth-secret";

describe("Phase H.1 — Authentication Secret Production Hardening Tests", () => {
  const validProductionSecret =
    "c8f7d9a0e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8";

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

    it("accepts strong, unpredictable secrets in production runtime", () => {
      const resolved = resolveAuthSecret({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: validProductionSecret,
      });

      expect(resolved).toBe(validProductionSecret);
    });
  });

  describe("2. Build Phase Behavior (NEXT_PHASE === 'phase-production-build')", () => {
    it("provides an ephemeral build-phase secret when building without production secrets", () => {
      const buildSecret = resolveAuthSecret({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      });

      expect(buildSecret).toBeDefined();
      expect(buildSecret.length).toBeGreaterThanOrEqual(MINIMUM_SECRET_LENGTH);
      expect(buildSecret).toContain("ephemeral_build_phase_secret");
    });

    it("preserves valid secret if provided during build phase", () => {
      const buildSecret = resolveAuthSecret({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
        BETTER_AUTH_SECRET: validProductionSecret,
      });

      expect(buildSecret).toBe(validProductionSecret);
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

      expect(isPlaceholderSecret(validProductionSecret)).toBe(false);
      expect(isPlaceholderSecret("Kj8#vL9$mQ2!zR5*tY7@wP1&sX4^uN6~")).toBe(false);
    });
  });
});
