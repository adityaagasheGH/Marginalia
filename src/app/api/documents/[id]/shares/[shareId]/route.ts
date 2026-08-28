import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeDocument, isOwner } from "@/lib/authorize";

/**
 * DELETE /api/documents/[id]/shares/[shareId] — revoke a link.
 *
 * Sets `revokedAt` rather than deleting the row. Two reasons: the authorizer
 * filters on `revokedAt: null`, so the link dies on the very next request;
 * and comments posted through that share keep their `shareId` foreign key,
 * so revoking access does not erase the discussion it produced.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  const { id, shareId } = await params;

  const viewer = await authorizeDocument(id, request);
  if (!viewer || !isOwner(viewer)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Scoped by documentId as well as id: an owner must not be able to revoke
  // a share belonging to a document they do not own by guessing its id.
  const result = await db.share.updateMany({
    where: { id: shareId, documentId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({ revoked: true });
}
