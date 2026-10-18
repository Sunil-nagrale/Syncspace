import "dotenv/config";
import { defineConfig } from "prisma/config";
import {
  getPrismaCliDatabaseUrl,
  isPrismaGenerateCommand,
} from "./src/lib/database-url";

export { getPrismaCliDatabaseUrl, isPrismaGenerateCommand };

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: getPrismaCliDatabaseUrl(),
  },
});
