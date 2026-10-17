import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { resolveAuthSecret } from "@/lib/auth-secret";

export { resolveAuthSecret };

function resolveTrustedOrigins(): string[] {
  const origins: string[] = [];
  const envOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (envOrigins) {
    origins.push(
      ...envOrigins
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    );
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl && !origins.includes(appUrl)) {
    origins.push(appUrl);
  }
  const authUrl = process.env.BETTER_AUTH_URL?.trim();
  if (authUrl && !origins.includes(authUrl)) {
    origins.push(authUrl);
  }
  if (process.env.NODE_ENV !== "production") {
    if (!origins.includes("http://localhost:3000")) {
      origins.push("http://localhost:3000");
    }
  }
  return origins;
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: resolveAuthSecret(),
  baseURL:
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000",
  trustedOrigins: resolveTrustedOrigins(),
  advanced: {
    useSecureCookies:
      process.env.NODE_ENV === "production" &&
      !process.env.BETTER_AUTH_URL?.startsWith("http://localhost:") &&
      !process.env.NEXT_PUBLIC_APP_URL?.startsWith("http://localhost:"),
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  user: {
    additionalFields: {
      color: {
        type: "string",
        required: false,
        defaultValue: "#6366F1",
      },
    },
  },
  rateLimit: {
    window: 60,
    max: 1000,
    customRules: {
      "/sign-up/email": {
        window: 60,
        max: 50,
      },
      "/sign-in/email": {
        window: 60,
        max: 50,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
