import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { resolveAuthSecret } from "@/lib/auth-secret";

export { resolveAuthSecret };

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: resolveAuthSecret(),
  baseURL:
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000",
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
