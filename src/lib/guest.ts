import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Guest identity for people who open a share link without an account.
 *
 * The cookie is signed, not encrypted: the display name is not secret, but it
 * must not be forgeable, or anyone could impersonate a commenter or delete
 * their posts. The cookie name includes the shareId, so an identity on one
 * shared document grants nothing on another.
 */

const MAX_NAME_LENGTH = 40;

export type GuestIdentity = { guestKey: string; name: string };

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    throw new Error("AUTH_SECRET is required to sign guest cookies.");
  }
  return value;
}

export function guestCookieName(shareId: string): string {
  return `guest_${shareId}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function serializeGuest(identity: GuestIdentity): string {
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns null on any problem, so a tampered cookie behaves like an absent one. */
export function parseGuest(value: string | undefined): GuestIdentity | null {
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  // Constant-time compare: `===` leaks how many leading bytes were correct.
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      typeof parsed?.guestKey === "string" &&
      typeof parsed?.name === "string" &&
      parsed.guestKey.length > 0 &&
      parsed.name.length > 0
    ) {
      return {
        guestKey: parsed.guestKey,
        name: parsed.name.slice(0, MAX_NAME_LENGTH),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function readGuestCookie(
  shareId: string,
): Promise<GuestIdentity | null> {
  const store = await cookies();
  return parseGuest(store.get(guestCookieName(shareId))?.value);
}

export function newGuestKey(): string {
  return randomBytes(16).toString("base64url");
}

export const GUEST_COOKIE_OPTIONS = {
  httpOnly: true, // unreadable from JS, so XSS cannot steal an identity
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 90,
};
