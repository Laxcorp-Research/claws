import dotenv from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

dotenv.config({ path: ".env.local" });

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
    directUrl: process.env["DIRECT_URL"],
  },
});
