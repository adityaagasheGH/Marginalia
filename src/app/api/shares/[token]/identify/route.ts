import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { identifySchema } from "@/lib/validation";
import {
  GUEST_COOKIE_OPTIONS,
  guestCookieName,
  newGuestKey,
  parseGuest,
  serializeGuest,
} from "@/lib/guest";

/**
 * POST /api/shares/[token]/identify — a guest gives a display name.
 *
 * Called once, when a guest posts their first comment. It mints a random
 * guestKey for this browser and stores { guestKey, name } in a signed,
 * httpOnly cookie scoped to this share.
 *
 * The key never leaves the server unsigned and is never readable by page
 * JavaScript, so a guest cannot claim another guest's identity by editing
 * localStorage or a visible cookie — which is what makes "delete your own
 * comment" meaningful for people without accounts.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = identifySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid name." },
      { status: 400 },
    );
  }

  const share = await db.share.findFirst({
    where: {
      token,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, permission: true },
  });

  if (!share) {
    return NextResponse.json(
      { error: "This link is no longer valid." },
      { status: 404 },
    );
  }

  if (share.permission !== "COMMENT") {
    return NextResponse.json(
      { error: "This link is view-only." },
      { status: 403 },
    );
  }

  // Reuse the existing key if this browser has already identified, so a name
  // change does not orphan the comments they have already posted.
  const cookieName = guestCookieName(share.id);
  const existing = parseGuest(
    request.headers
      .get("cookie")
      ?.split("; ")
      .find((c) => c.startsWith(`${cookieName}=`))
      ?.split("=")[1],
  );

  const identity = {
    guestKey: existing?.guestKey ?? newGuestKey(),
    name: parsed.data.name,
  };

  const response = NextResponse.json({ name: identity.name });
  response.cookies.set(cookieName, serializeGuest(identity), GUEST_COOKIE_OPTIONS);
  return response;
}
