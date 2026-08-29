import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeDocument, isOwner } from "@/lib/authorize";

/**
 * Revoke a link. Sets `revokedAt` rather than deleting, so comments posted
 * through the share keep their author reference.
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

  const result = await db.share.updateMany({
    where: { id: shareId, documentId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({ revoked: true });
}
