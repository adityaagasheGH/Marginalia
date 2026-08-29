import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeDocument, canComment } from "@/lib/authorize";
import { createCommentSchema } from "@/lib/validation";

/**
 * Read and post comments. Accepts an owner session or a `?token=` share link.
 * Reading is open to any viewer; posting requires COMMENT permission.
 */

/** Author identity is flattened for the client. */
type CommentDTO = {
  id: string;
  parentId: string | null;
  body: string;
  pageNumber: number | null;
  createdAt: Date;
  authorName: string;
  isOwner: boolean;
  /** True when the *requesting* viewer wrote this one, so the UI can offer delete. */
  mine: boolean;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const viewer = await authorizeDocument(id, request);
  if (!viewer) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const document = await db.document.findUnique({
    where: { id },
    select: { ownerId: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const rows = await db.comment.findMany({
    where: { documentId: id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      parentId: true,
      body: true,
      pageNumber: true,
      createdAt: true,
      userId: true,
      shareId: true,
      guestName: true,
      guestKey: true,
      user: { select: { name: true } },
    },
  });

  const comments: CommentDTO[] = rows.map((c) => ({
    id: c.id,
    parentId: c.parentId,
    body: c.body,
    pageNumber: c.pageNumber,
    createdAt: c.createdAt,
    authorName: c.user?.name ?? c.guestName ?? "Guest",
    isOwner: c.userId === document.ownerId,
    mine:
      viewer.role === "owner"
        ? c.userId === viewer.userId
        : // Both the share and the browser key must match.
          c.shareId === viewer.shareId &&
          c.guestKey !== null &&
          c.guestKey === viewer.guestKey,
  }));

  return NextResponse.json({
    comments,
    viewer: {
      role: viewer.role,
      canComment: canComment(viewer),
      // Null until a guest names themselves.
      name: viewer.role === "owner" ? null : viewer.guestName,
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const viewer = await authorizeDocument(id, request);
  if (!viewer) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!canComment(viewer)) {
    return NextResponse.json(
      { error: "This link is view-only." },
      { status: 403 },
    );
  }
  // The comment_single_author CHECK requires guestName alongside shareId.
  if (viewer.role === "guest" && (!viewer.guestKey || !viewer.guestName)) {
    return NextResponse.json(
      { error: "Add a display name before commenting.", needsName: true },
      { status: 428 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createCommentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid comment." },
      { status: 400 },
    );
  }

  const { body, parentId, pageNumber } = parsed.data;

  // One level deep: replying to a reply attaches to its parent.
  let resolvedParentId: string | null = null;
  if (parentId) {
    const parent = await db.comment.findFirst({
      where: { id: parentId, documentId: id, deletedAt: null },
      select: { id: true, parentId: true },
    });
    if (!parent) {
      return NextResponse.json(
        { error: "That comment no longer exists." },
        { status: 404 },
      );
    }
    resolvedParentId = parent.parentId ?? parent.id;
  }

  const created = await db.comment.create({
    data: {
      documentId: id,
      parentId: resolvedParentId,
      body,
      pageNumber: pageNumber ?? null,
      // Exactly one identity branch, enforced by a CHECK constraint.
      ...(viewer.role === "owner"
        ? { userId: viewer.userId }
        : {
            shareId: viewer.shareId,
            guestKey: viewer.guestKey,
            guestName: viewer.guestName,
          }),
    },
    select: {
      id: true,
      parentId: true,
      body: true,
      pageNumber: true,
      createdAt: true,
      user: { select: { name: true } },
      guestName: true,
    },
  });

  if (viewer.role === "guest") {
    await db.share
      .update({ where: { id: viewer.shareId }, data: { lastAccessAt: new Date() } })
      .catch(() => {});
  }

  return NextResponse.json(
    {
      id: created.id,
      parentId: created.parentId,
      body: created.body,
      pageNumber: created.pageNumber,
      createdAt: created.createdAt,
      authorName: created.user?.name ?? created.guestName ?? "Guest",
      isOwner: viewer.role === "owner",
      mine: true,
    },
    { status: 201 },
  );
}
