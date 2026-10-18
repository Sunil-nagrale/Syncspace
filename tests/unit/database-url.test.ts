import { describe, it, expect } from "vitest";
import { getPrismaCliDatabaseUrl } from "../../prisma.config";
import { getDatabaseUrl } from "@/lib/prisma";
import {
  extractDatabaseHostname,
  isLoopbackHost,
  isTemplateOrPlaceholderUrl,
  validateProductionDatabaseUrl,
} from "@/lib/database-url";

describe("Phase J.1 — Database Connection URL Separation and Production Hardening", () => {
  const dummyPooledUrl =
    "postgresql://app_user:secret_pw@ep-cool-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
  const dummyDirectUrl =
    "postgresql://app_user:secret_pw@ep-cool.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const envExampleSampleUrl =
    "postgresql://user:password@localhost:5432/syncspace?schema=public";

  describe("Phase J.1.1 — Connection Separation Precedence", () => {
    describe("1. Prisma CLI Database Resolution (prisma.config.ts)", () => {
      it("prefers DIRECT_URL over DATABASE_URL when both are present", () => {
        const url = getPrismaCliDatabaseUrl({
          DIRECT_URL: dummyDirectUrl,
          DATABASE_URL: dummyPooledUrl,
        });

        expect(url).toBe(dummyDirectUrl);
      });

      it("trims whitespace from DIRECT_URL", () => {
        const url = getPrismaCliDatabaseUrl({
          DIRECT_URL: `  ${dummyDirectUrl}  `,
          DATABASE_URL: dummyPooledUrl,
        });

        expect(url).toBe(dummyDirectUrl);
      });

      it("falls back to DATABASE_URL when DIRECT_URL is absent", () => {
        const url = getPrismaCliDatabaseUrl({
          DATABASE_URL: dummyPooledUrl,
        });

        expect(url).toBe(dummyPooledUrl);
      });

      it("falls back to DATABASE_URL when DIRECT_URL is empty or whitespace", () => {
        const url = getPrismaCliDatabaseUrl({
          DIRECT_URL: "   ",
          DATABASE_URL: dummyPooledUrl,
        });

        expect(url).toBe(dummyPooledUrl);
      });

      it("ignores placeholder DIRECT_URL and falls back to valid DATABASE_URL in development", () => {
        const placeholders = [
          "postgresql://user:password@localhost:5432/placeholder",
          "postgresql://user:changeme@db.example.com/mydb",
          "postgresql://your-user:your-password@db.com/mydb",
          "dummy",
        ];

        for (const placeholder of placeholders) {
          const url = getPrismaCliDatabaseUrl({
            DIRECT_URL: placeholder,
            DATABASE_URL: dummyPooledUrl,
          });

          expect(url).toBe(dummyPooledUrl);
        }
      });

      it("fails closed in production when neither DIRECT_URL nor DATABASE_URL is set", () => {
        const prodEnvironments: Array<Record<string, string>> = [
          { NODE_ENV: "production" },
          { VERCEL: "1" },
          { VERCEL_ENV: "production" },
          { SYNCSPACE_STRICT_PRODUCTION: "true" },
          { AWS_EXECUTION_ENV: "AWS_ECS_FARGATE" },
        ];

        for (const env of prodEnvironments) {
          expect(() =>
            getPrismaCliDatabaseUrl(env, { isClientGeneration: false })
          ).toThrow(
            "[Security Configuration Error] Missing required database configuration for migrations in production. Specify DIRECT_URL or DATABASE_URL."
          );
        }
      });

      it("fails closed in production if both DIRECT_URL and DATABASE_URL are placeholders", () => {
        expect(() =>
          getPrismaCliDatabaseUrl(
            {
              NODE_ENV: "production",
              DIRECT_URL: "postgresql://user:placeholder@db.com/db",
              DATABASE_URL: "postgresql://user:changeme@db.com/db",
            },
            { isClientGeneration: false }
          )
        ).toThrow("[Security Configuration Error]");
      });

      it("permits client generation during build without live database credentials", () => {
        // 1. Explicit option flag
        const clientGenUrl = getPrismaCliDatabaseUrl(
          { NODE_ENV: "production" },
          { isClientGeneration: true }
        );
        expect(clientGenUrl).toContain("placeholder");

        // 2. Next.js build phase env var
        const buildPhaseUrl = getPrismaCliDatabaseUrl({
          NODE_ENV: "production",
          NEXT_PHASE: "phase-production-build",
        });
        expect(buildPhaseUrl).toContain("placeholder");
      });

      it("defaults to local postgres connection in non-production environments when omitted", () => {
        const localUrl = getPrismaCliDatabaseUrl(
          { NODE_ENV: "development" },
          { isClientGeneration: false }
        );
        expect(localUrl).toBe(
          "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public"
        );
      });
    });

    describe("2. Application Runtime Database Resolution (src/lib/prisma.ts)", () => {
      it("strictly uses DATABASE_URL for application runtime", () => {
        const url = getDatabaseUrl({
          DATABASE_URL: dummyPooledUrl,
          DIRECT_URL: dummyDirectUrl,
        });

        expect(url).toBe(dummyPooledUrl);
      });

      it("never falls back to DIRECT_URL for runtime queries", () => {
        const localFallback = getDatabaseUrl({
          DIRECT_URL: dummyDirectUrl,
          NODE_ENV: "development",
        });

        expect(localFallback).toBe(
          "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public"
        );
        expect(localFallback).not.toBe(dummyDirectUrl);
      });

      it("fails fast in production when DATABASE_URL is missing", () => {
        expect(() =>
          getDatabaseUrl({
            NODE_ENV: "production",
            DIRECT_URL: dummyDirectUrl,
          })
        ).toThrow(
          "[Security Configuration Error] Missing required environment variable DATABASE_URL in production."
        );
      });

      it("allows harmless fallback during Next.js production build phase", () => {
        const buildUrl = getDatabaseUrl({
          NODE_ENV: "production",
          NEXT_PHASE: "phase-production-build",
        });

        expect(buildUrl).toBe(
          "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public"
        );
      });
    });
  });

  describe("Phase J.1.2 — Reject Example and Localhost Database URLs in Production", () => {
    describe("1. Hostname Extraction and Loopback Detection", () => {
      it("extracts hostname accurately across various PostgreSQL URL formats", () => {
        expect(
          extractDatabaseHostname(
            "postgresql://user:password@localhost:5432/syncspace?schema=public"
          )
        ).toBe("localhost");
        expect(
          extractDatabaseHostname(
            "postgresql://user:password@127.0.0.1:5432/syncspace"
          )
        ).toBe("127.0.0.1");
        expect(
          extractDatabaseHostname(
            "postgresql://user:password@[::1]:5432/syncspace"
          )
        ).toBe("::1");
        expect(
          extractDatabaseHostname(
            "postgresql://app:prod_pw@ep-cool.neon.tech/neondb"
          )
        ).toBe("ep-cool.neon.tech");
        expect(
          extractDatabaseHostname("postgresql://localhost/syncspace")
        ).toBe("localhost");
      });

      it("accurately identifies loopback hostnames", () => {
        expect(isLoopbackHost("localhost")).toBe(true);
        expect(isLoopbackHost("127.0.0.1")).toBe(true);
        expect(isLoopbackHost("127.0.0.2")).toBe(true);
        expect(isLoopbackHost("127.1.2.3")).toBe(true);
        expect(isLoopbackHost("::1")).toBe(true);
        expect(isLoopbackHost("[::1]")).toBe(true);
        expect(isLoopbackHost("0.0.0.0")).toBe(true);
        expect(isLoopbackHost("subdomain.localhost")).toBe(true);

        expect(isLoopbackHost("ep-cool.neon.tech")).toBe(false);
        expect(isLoopbackHost("db.example.com")).toBe(false);
        expect(isLoopbackHost("10.0.0.1")).toBe(false);
        expect(isLoopbackHost(null)).toBe(false);
      });

      it("accurately identifies template and placeholder credentials", () => {
        expect(isTemplateOrPlaceholderUrl(envExampleSampleUrl)).toBe(true);
        expect(isTemplateOrPlaceholderUrl("postgresql://user:password@db.com/db")).toBe(true);
        expect(isTemplateOrPlaceholderUrl("postgresql://user:pass@db.com/db")).toBe(true);
        expect(isTemplateOrPlaceholderUrl("postgresql://app:changeme@db.com/db")).toBe(true);
        expect(isTemplateOrPlaceholderUrl("postgresql://app:placeholder@db.com/db")).toBe(true);
        expect(isTemplateOrPlaceholderUrl("dummy")).toBe(true);

        expect(isTemplateOrPlaceholderUrl(dummyDirectUrl)).toBe(false);
        expect(isTemplateOrPlaceholderUrl(dummyPooledUrl)).toBe(false);
      });
    });

    describe("2. Production Migration URL Validation (getPrismaCliDatabaseUrl)", () => {
      it("rejects the exact .env.example sample URL for production migrations", () => {
        // Direct URL configured with .env.example sample
        expect(() =>
          getPrismaCliDatabaseUrl({
            NODE_ENV: "production",
            DIRECT_URL: envExampleSampleUrl,
          })
        ).toThrow("[Security Configuration Error]");

        // Database URL fallback configured with .env.example sample
        expect(() =>
          getPrismaCliDatabaseUrl({
            NODE_ENV: "production",
            DATABASE_URL: envExampleSampleUrl,
          })
        ).toThrow("[Security Configuration Error]");

        // On deployed platform (Vercel)
        expect(() =>
          getPrismaCliDatabaseUrl({
            VERCEL: "1",
            DIRECT_URL: envExampleSampleUrl,
          })
        ).toThrow("[Security Configuration Error]");
      });

      it("rejects production migration URLs pointing to localhost or loopback hosts", () => {
        const loopbackUrls = [
          "postgresql://prod_user:strong_password@localhost:5432/syncspace",
          "postgresql://prod_user:strong_password@127.0.0.1:5432/syncspace",
          "postgresql://prod_user:strong_password@127.0.0.2:5432/syncspace",
          "postgresql://prod_user:strong_password@[::1]:5432/syncspace",
          "postgresql://prod_user:strong_password@0.0.0.0:5432/syncspace",
        ];

        for (const loopbackUrl of loopbackUrls) {
          // As DIRECT_URL
          expect(() =>
            getPrismaCliDatabaseUrl({
              NODE_ENV: "production",
              DIRECT_URL: loopbackUrl,
            })
          ).toThrow(
            "[Security Configuration Error] Insecure DIRECT_URL detected in production. Loopback and local addresses are not permitted in production environments."
          );

          // As DATABASE_URL fallback
          expect(() =>
            getPrismaCliDatabaseUrl({
              NODE_ENV: "production",
              DATABASE_URL: loopbackUrl,
            })
          ).toThrow(
            "[Security Configuration Error] Insecure DATABASE_URL detected in production. Loopback and local addresses are not permitted in production environments."
          );
        }
      });

      it("never includes passwords, connection strings, or hosts in error messages", () => {
        const secretPassword = "super_secret_unique_password_12345";
        const sensitiveUrl = `postgresql://prod_admin:${secretPassword}@localhost:5432/syncspace`;

        try {
          validateProductionDatabaseUrl(sensitiveUrl, "DIRECT_URL");
          expect.fail("Should have thrown");
        } catch (err: unknown) {
          const msg = (err as Error).message;
          expect(msg).not.toContain(secretPassword);
          expect(msg).not.toContain("localhost");
          expect(msg).not.toContain("5432");
          expect(msg).not.toContain("postgresql://");
          expect(msg).toContain("[Security Configuration Error]");
        }
      });
    });

    describe("3. Production Application Runtime URL Validation (getDatabaseUrl)", () => {
      it("rejects the exact .env.example sample URL in production application runtime", () => {
        expect(() =>
          getDatabaseUrl({
            NODE_ENV: "production",
            DATABASE_URL: envExampleSampleUrl,
          })
        ).toThrow("[Security Configuration Error]");

        expect(() =>
          getDatabaseUrl({
            VERCEL: "1",
            DATABASE_URL: envExampleSampleUrl,
          })
        ).toThrow("[Security Configuration Error]");
      });

      it("rejects loopback and localhost URLs in production application runtime", () => {
        const loopbackUrls = [
          "postgresql://prod_user:strong_password@localhost:5432/syncspace",
          "postgresql://prod_user:strong_password@127.0.0.1:5432/syncspace",
          "postgresql://prod_user:strong_password@[::1]:5432/syncspace",
        ];

        for (const url of loopbackUrls) {
          expect(() =>
            getDatabaseUrl({
              NODE_ENV: "production",
              DATABASE_URL: url,
            })
          ).toThrow(
            "[Security Configuration Error] Insecure DATABASE_URL detected in production. Loopback and local addresses are not permitted in production environments."
          );
        }
      });

      it("rejects template/placeholder credentials even on cloud hosts in production runtime", () => {
        const templateUrls = [
          "postgresql://user:password@ep-pooler.us-east-2.aws.neon.tech/neondb",
          "postgresql://app_user:placeholder@ep-pooler.us-east-2.aws.neon.tech/neondb",
          "postgresql://app_user:changeme@ep-pooler.us-east-2.aws.neon.tech/neondb",
        ];

        for (const url of templateUrls) {
          expect(() =>
            getDatabaseUrl({
              NODE_ENV: "production",
              DATABASE_URL: url,
            })
          ).toThrow(
            "[Security Configuration Error] Insecure or placeholder DATABASE_URL detected in production. Template credentials and example values are not permitted."
          );
        }
      });
    });

    describe("4. Preserving Legitimate Staging and Local Development Environments", () => {
      it("resolves valid non-loopback staging URLs correctly in production", () => {
        // Prisma CLI prefers valid DIRECT_URL
        expect(
          getPrismaCliDatabaseUrl({
            NODE_ENV: "production",
            DIRECT_URL: dummyDirectUrl,
            DATABASE_URL: dummyPooledUrl,
          })
        ).toBe(dummyDirectUrl);

        // Prisma CLI falls back to valid DATABASE_URL if DIRECT_URL is omitted
        expect(
          getPrismaCliDatabaseUrl({
            NODE_ENV: "production",
            DATABASE_URL: dummyPooledUrl,
          })
        ).toBe(dummyPooledUrl);

        // Runtime resolves valid DATABASE_URL
        expect(
          getDatabaseUrl({
            NODE_ENV: "production",
            DATABASE_URL: dummyPooledUrl,
          })
        ).toBe(dummyPooledUrl);
      });

      it("preserves legitimate local development behavior with local PostgreSQL", () => {
        const localDockerUrl =
          "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public";

        // Runtime accepts local PostgreSQL in development
        expect(
          getDatabaseUrl({
            NODE_ENV: "development",
            DATABASE_URL: localDockerUrl,
          })
        ).toBe(localDockerUrl);

        // Prisma CLI accepts local PostgreSQL in development
        expect(
          getPrismaCliDatabaseUrl({
            NODE_ENV: "development",
            DATABASE_URL: localDockerUrl,
          })
        ).toBe(localDockerUrl);

        // Fallback default in development
        expect(
          getDatabaseUrl({
            NODE_ENV: "development",
          })
        ).toBe(localDockerUrl);

        expect(
          getPrismaCliDatabaseUrl({
            NODE_ENV: "development",
          })
        ).toBe(localDockerUrl);
      });

      it("preserves credential-free Prisma client generation during build", () => {
        expect(
          getPrismaCliDatabaseUrl(
            { NODE_ENV: "production" },
            { isClientGeneration: true }
          )
        ).toContain("placeholder");

        expect(
          getPrismaCliDatabaseUrl({
            NODE_ENV: "production",
            NEXT_PHASE: "phase-production-build",
          })
        ).toContain("placeholder");

        expect(
          getDatabaseUrl({
            NODE_ENV: "production",
            NEXT_PHASE: "phase-production-build",
          })
        ).toBe(
          "postgresql://postgres:postgres@localhost:5432/syncspace?schema=public"
        );
      });
    });
  });
});
