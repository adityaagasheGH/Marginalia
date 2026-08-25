import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

/**
 * Route protection, run at the edge before any page renders.
 *
 * It imports ONLY auth.config.ts (no Prisma, no bcrypt) because middleware
 * runs on the Edge runtime, which cannot load Node-only modules. The JWT is
 * verified from its cookie signature alone — no database call needed.
 */
const { auth } = NextAuth(authConfig);

// Routes that require a signed-in user.
const PROTECTED = ["/dashboard", "/documents"];
// Auth pages a signed-in user should be redirected away from.
const AUTH_PAGES = ["/login", "/signup"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth?.user;

  const onProtected = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  const onAuthPage = AUTH_PAGES.includes(pathname);

  // Not signed in and reaching for a protected page -> send to /login,
  // remembering where they wanted to go so we can return them after login.
  if (onProtected && !isLoggedIn) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  // Already signed in but sitting on /login or /signup -> send to dashboard.
  if (onAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
});

/**
 * Which paths run this middleware.
 *
 * Explicit path matchers, not a catch-all negative-lookahead regex: Next 15
 * silently skips middleware whose matcher it cannot parse, which produces the
 * worst possible failure mode — protected routes quietly become public with no
 * error anywhere. Listing the routes we actually gate is both clearer and
 * verifiable.
 */
export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/documents/:path*",
    "/login",
    "/signup",
  ],
};
