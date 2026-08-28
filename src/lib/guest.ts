import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Guest identity for people who open a share link without an account.
 *
 * The problem: a guest has no user row, but comments still need an author,
 * and a guest must be able to delete their own comment later. So each
 * browser gets a random `guestKey` plus a display name, stored in a cookie.
 *
 * The cookie is **signed**, not encrypted. Its contents are not secret — the
 * guest chose the name — but they must not be *forgeable*, or anyone could
 * impersonate another commenter or delete their posts by editing the cookie.
 * An HMAC over the payload makes tampering detectable.
 *
 * Scoping matters: the cookie name includes the shareId, so an identity on
 * one shared document grants nothing on another (docs/API_SPEC.md).
 */

const MAX_NAME_LENGTH = 40;

export type GuestIdentity = { guestKey: string; name: string };

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    // Failing loudly beats signing with a default — an empty key means every
    // guest cookie is forgeable by anyone who reads this source file.
    throw new Error("AUTH_SECRET is required to sign guest cookies.");
  }
  return value;
}

/** One cookie per share, so identities never leak across documents. */
export function guestCookieName(shareId: string): string {
  return `guest_${shareId}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** `<base64url(json)>.<hmac>` */
export function serializeGuest(identity: GuestIdentity): string {
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify and decode. Returns null on any problem — bad shape, bad signature,
 * unparseable payload — so callers treat a tampered cookie exactly like an
 * absent one rather than trusting a half-valid value.
 */
export function parseGuest(value: string | undefined): GuestIdentity | null {
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  // Compare in constant time: a plain === leaks, through timing, how many
  // leading bytes of a forged signature were correct.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      typeof parsed?.guestKey === "string" &&
      typeof parsed?.name === "string" &&
      parsed.guestKey.length > 0 &&
      parsed.name.length > 0
    ) {
      return { guestKey: parsed.guestKey, name: parsed.name.slice(0, MAX_NAME_LENGTH) };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Read this browser's identity for one share, if it has been set. */
export async function readGuestCookie(shareId: string): Promise<GuestIdentity | null> {
  const store = await cookies();
  return parseGuest(store.get(guestCookieName(shareId))?.value);
}

/** A fresh opaque id for a browser. Never derived from anything user-supplied. */
export function newGuestKey(): string {
  return randomBytes(16).toString("base64url");
}

/** Cookie options shared by every guest cookie write. */
export const GUEST_COOKIE_OPTIONS = {
  httpOnly: true, // JavaScript cannot read it, so XSS cannot steal an identity
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 90, // 90 days
};
