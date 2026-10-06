import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    schema: path.join(__dirname, "prisma", "schema.prisma"),
    datasource: {
        // Optional read: `prisma generate` must work when DATABASE_URL is unset.
        // Connection commands (migrate/db push) still fail on their own without a URL.
        url: process.env.DATABASE_URL,
    },
    migrations: {
        path: path.join(__dirname, "prisma", "migrations"),
    },
});
