import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { loginSchema } from "@/lib/validation";

/**
 * Full Auth.js setup: the edge-safe config plus the Credentials provider,
 * which needs Prisma and bcrypt and therefore only runs in the Node runtime.
 *
 * Exports:
 *   auth     - read the current session in Server Components / route handlers
 *   signIn   - begin a sign-in (used by the login form's server action)
 *   signOut  - end a session
 *   handlers - GET/POST for the /api/auth/[...nextauth] catch-all route
 */
export const { auth, signIn, signOut, handlers } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      /**
       * Return a user object to grant sign-in, or null to reject.
       *
       * Every rejection path returns null with no distinguishing detail: an
       * unknown email and a wrong password are indistinguishable to the
       * caller. A different response for a known-but-wrong email would be an
       * account-enumeration oracle.
       *
       * We also always run bcrypt.compare, even when no user was found (using
       * a dummy hash), so response time does not reveal whether the email
       * exists.
       */
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await db.user.findUnique({
          where: { email },
          select: { id: true, name: true, email: true, passwordHash: true },
        });

        // Constant-ish time: compare against a real hash if the user exists,
        // otherwise against a fixed dummy so both branches pay the bcrypt cost.
        const hash =
          user?.passwordHash ??
          "$2b$12$da5xgTGZJaw8ipo5dgYx5O8SdnqiYB689t7CEtj87ugmXvU4/1tMi";

        const ok = await verifyPassword(password, hash);
        if (!user || !ok) return null;

        // Whatever we return here becomes the `user` in the jwt callback.
        // passwordHash is deliberately not included.
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
});
