import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeDocument, isOwner } from "@/lib/authorize";
import { createShareSchema } from "@/lib/validation";

/**
 * Mint and list share links. Owner only — a guest minting further links would
 * survive revoking the original.
 */

/** 256 bits. The link is the credential, so it must be unguessable. */
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
