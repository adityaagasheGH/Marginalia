import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeDocument, isOwner } from "@/lib/authorize";
import { createShareSchema } from "@/lib/validation";

/**
 * POST /api/documents/[id]/shares — mint a share link.
 * GET  /api/documents/[id]/shares — list the active ones.
 *
 * Owner only. A guest holding a valid link must not be able to mint further
 * links, or one leaked link would silently become permanent access that
 * survives revoking the original.
 */

/**
 * 32 random bytes, base64url. That is 256 bits of entropy — the link itself
 * is the credential, so it has to be unguessable by brute force. base64url
 * is chosen over hex because it is URL-safe with no escaping and shorter for
 * the same entropy.
 */
function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Absolute URL a guest can open. */
function shareUrl(request: Request, token: string): string {
  return new URL(`/shared/${token}`, new URL(request.url).origin).toString();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const viewer = await authorizeDocument(id, request);
  // 404 rather than 403 throughout: a 403 would confirm the document exists.
  if (!viewer || !isOwner(viewer)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createShareSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { permission, expiresInDays } = parsed.data;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const token = newShareToken();
  const share = await db.share.create({
    data: {
      documentId: id,
      token,
      createdById: viewer.userId,
      permission,
      expiresAt,
    },
    select: { id: true, permission: true, expiresAt: true, createdAt: true },
  });

  return NextResponse.json(
    { ...share, url: shareUrl(request, token) },
    { status: 201 },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const viewer = await authorizeDocument(id, request);
  if (!viewer || !isOwner(viewer)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const shares = await db.share.findMany({
    where: {
      documentId: id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      token: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
      lastAccessAt: true,
    },
  });

  return NextResponse.json({
    shares: shares.map(({ token, ...rest }) => ({
      ...rest,
      url: shareUrl(request, token),
    })),
  });
}
