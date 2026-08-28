import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeDocument, canComment } from "@/lib/authorize";
import { createCommentSchema } from "@/lib/validation";

/**
 * GET  /api/documents/[id]/comments — read the thread.
 * POST /api/documents/[id]/comments — post a comment or a reply.
 *
 * Both accept an owner session or a valid `?token=` share link, resolved by
 * the same authorizer every document route uses. Reading is open to any
 * viewer; posting additionally requires COMMENT permission.
 */

/** Shape returned to the client. Author identity is flattened deliberately. */
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
        : // A guest owns a comment only if both the share and the browser key
          // match. Comparing guestKey alone would let a guest on a different
          // share delete comments that happen to share a key.
          c.shareId === viewer.shareId &&
          c.guestKey !== null &&
          c.guestKey === viewer.guestKey,
  }));

  return NextResponse.json({
    comments,
    viewer: {
      role: viewer.role,
      canComment: canComment(viewer),
      // Null for a guest who has not named themselves yet — the UI uses this
      // to decide whether to show the "what should we call you?" prompt.
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
  // A guest must introduce themselves before posting; the database CHECK
  // constraint requires guestName alongside shareId, so this would fail at
  // the write anyway. Catching it here produces a useful message instead.
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

  // Threading is one level deep. If the target is itself a reply, attach to
  // its parent instead of rejecting — the user's intent ("reply to this
  // conversation") is clear, and a flat second level is what the schema and
  // the UI both expect.
  let resolvedParentId: string | null = null;
  if (parentId) {
    const parent = await db.comment.findFirst({
      // Scoped to this document: a comment id from another document must not
      // become a parent here.
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
      // Exactly one identity branch is populated — the comment_single_author
      // CHECK constraint in the migration enforces this at the database level.
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

  // Record that this link is being used, for the owner's share list.
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
