import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * This file must not import Prisma, bcrypt, or anything with a Node-only
 * dependency, because `middleware.ts` imports it and middleware runs on the
 * Edge runtime. The Credentials provider (which needs both) is added in
 * auth.ts instead. See docs/SECURITY.md § 2.
 */
export const authConfig = {
  // The Credentials provider is Node-only (Prisma + bcrypt), so it is added
  // in auth.ts, not here. This empty array keeps the object a valid
  // NextAuthConfig; the spread in auth.ts fills it in.
  providers: [],
  // In production mode, Auth.js rejects requests whose Host header it
  // doesn't recognize ("UntrustedHost") unless told to trust it. Vercel and
  // `next start` both put the app behind a host Auth.js can't otherwise
  // verify against a fixed URL, so this is required in both environments,
  // not just a Vercel-specific tweak.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    // Store the session in a signed JWT cookie rather than a database table.
    // Auth.js forces this mode for the Credentials provider anyway; making it
    // explicit documents the intent. 30-day expiry per SECURITY.md.
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days, in seconds
  },
  callbacks: {
    /**
     * Runs in middleware on every protected request. Returning false (or a
     * redirect) blocks access. We only gate here; the route handlers still do
     * their own per-document authorization via lib/authorize.ts.
     */
    authorized({ auth }) {
      return !!auth?.user;
    },
    /**
     * The JWT is created at sign-in and re-read on every request. We copy the
     * user's id onto the token so downstream code can read session.user.id
     * without a database lookup.
     */
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    /**
     * Shapes what `auth()` / `useSession()` expose. We surface the id and
     * strip everything we don't explicitly want the client to see.
     */
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
