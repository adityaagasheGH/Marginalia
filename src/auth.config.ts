import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the Auth.js config. Must not import Prisma or bcrypt —
 * middleware.ts imports this and runs on the Edge runtime. The Credentials
 * provider is added in auth.ts instead.
 */
export const authConfig = {
  providers: [],
  // Auth.js rejects unrecognized Host headers in production unless trusted.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    // Middleware-level gate only; routes still authorize per document.
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
