import { PrismaClient } from "@prisma/client";

/**
 * A single shared Prisma client for the whole app.
 *
 * Why a singleton: `next dev` hot-reloads modules on every file save. A bare
 * `new PrismaClient()` at module scope would therefore create a fresh
 * connection pool on each reload, and Neon would eventually refuse new
 * connections. `globalThis` survives hot reloads, so we stash the client
 * there in development and reuse it.
 *
 * In production the module is evaluated once per serverless instance, so the
 * global is unnecessary — but harmless, and keeping one code path is simpler
 * than branching.
 */

// `globalThis` is typed as having no properties, so we widen it here rather
// than reaching for `any`.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Log slow/failed queries in dev; stay quiet in production so we never
    // print a query containing user data to the platform logs.
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
