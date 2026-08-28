import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeDocument } from "@/lib/authorize";

/**
 * DELETE /api/documents/[id]/comments/[commentId]
 *
 * The owner may delete any comment on their document; a guest may delete
 * only their own. Deletion is soft — `deletedAt` is set and the GET route
 * filters those rows out — because a hard delete would cascade to any
 * replies underneath it and silently remove other people's words.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;

  const viewer = await authorizeDocument(id, request);
  if (!viewer) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const comment = await db.comment.findFirst({
    where: { id: commentId, documentId: id, deletedAt: null },
    select: { userId: true, shareId: true, guestKey: true },
  });
  if (!comment) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const allowed =
    viewer.role === "owner"
      ? // The document owner moderates their own document. authorizeDocument
        // already proved they own it, so no further check is needed.
        true
      : // A guest must match on BOTH the share and the browser key. Matching
        // guestKey alone would let a guest holding a different link delete
        // comments here if the keys ever collided.
        comment.shareId === viewer.shareId &&
        comment.guestKey !== null &&
        comment.guestKey === viewer.guestKey;

  if (!allowed) {
    return NextResponse.json(
      { error: "You can only delete your own comments." },
      { status: 403 },
    );
  }

  await db.comment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ deleted: true });
}
