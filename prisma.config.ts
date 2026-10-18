import "dotenv/config";
import { defineConfig } from "prisma/config";
import { getPrismaCliDatabaseUrl } from "./src/lib/database-url";

export { getPrismaCliDatabaseUrl };

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: getPrismaCliDatabaseUrl(),
  },
});
