import { Prisma, PrismaClient } from "@prisma/client";

/**
 * A single shared Prisma client for the whole app, with automatic retry on
 * transient connection failures.
 *
 * Why the retry: Neon's free tier suspends the compute after a few minutes
 * of inactivity. The first query after an idle period fails outright with
 * "Can't reach database server" while the instance wakes up (~1-2s). Without
 * a retry that surfaced as a login rejection — the user was told "Invalid
 * email or password" when the password was fine and the database was asleep.
 *
 * Why a singleton: `next dev` hot-reloads modules on every file save. A bare
 * `new PrismaClient()` at module scope would create a fresh connection pool
 * on each reload until Neon refused new connections. `globalThis` survives
 * hot reloads, so we stash the client there in development and reuse it.
 */

/** Prisma error codes that mean "try again", not "your query is wrong". */
const TRANSIENT_CODES = new Set([
  "P1001", // can't reach database server
  "P1002", // database server timed out
  "P1008", // operation timed out
  "P1017", // server closed the connection
]);

function isTransient(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_CODES.has(error.code);
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createClient() {
  const base = new PrismaClient({
    // Log failures in dev; stay quiet in production so we never print a
    // query containing user data to the platform logs.
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        const MAX_ATTEMPTS = 4;
        let lastError: unknown;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          try {
            return await query(args);
          } catch (error) {
            if (!isTransient(error)) throw error; // a real error: surface it
            lastError = error;
            // 300ms, 600ms, 1200ms — covers a typical Neon cold start.
            if (attempt < MAX_ATTEMPTS - 1) await sleep(300 * 2 ** attempt);
          }
        }
        throw lastError;
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
