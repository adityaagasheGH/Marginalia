import type { DefaultSession } from "next-auth";

/**
 * Augment Auth.js's built-in types so `session.user.id` and `token.id` are
 * recognized across the app. Without this, TypeScript does not know the user
 * object carries an id (we put it there in the jwt/session callbacks).
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
