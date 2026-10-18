import { describe, it, expect } from "vitest";
import { getPrismaCliDatabaseUrl } from "../../prisma.config";
import { getDatabaseUrl } from "@/lib/prisma";

describe("Phase J.1.1 — Database Connection URL Separation Tests", () => {
  const dummyPooledUrl =
    "postgresql://app_user:secret_pw@ep-cool-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
  const dummyDirectUrl =
    "postgresql://app_user:secret_pw@ep-cool.us-east-2.aws.neon.tech/neondb?sslmode=require";

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

    it("ignores placeholder DIRECT_URL and falls back to valid DATABASE_URL", () => {
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
      // Even if DIRECT_URL is configured, runtime queries must NOT use it
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
          DIRECT_URL: dummyDirectUrl, // DIRECT_URL cannot satisfy runtime pooling requirement
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
