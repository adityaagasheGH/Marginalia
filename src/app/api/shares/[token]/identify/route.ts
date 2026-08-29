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
 * A guest gives a display name. Mints a per-browser key and stores it in a
 * signed httpOnly cookie scoped to this share.
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

  // Reuse an existing key so renaming does not orphan earlier comments.
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
