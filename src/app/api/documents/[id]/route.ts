import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeDocument, isOwner } from "@/lib/authorize";
import { deletePdf } from "@/lib/blob";

/**
 * GET /api/documents/[id] — metadata for the reader page.
 *
 * Resolves the caller through authorizeDocument (the single chokepoint) and
 * returns 404 — never 403 — when they have no claim on the document, so an
 * unauthorized request can't even confirm the id exists.
 */
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
    select: {
      id: true,
      filename: true,
      status: true,
      summary: true,
      pageCount: true,
      sizeBytes: true,
      errorMessage: true,
      createdAt: true,
    },
  });
  if (!document) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    ...document,
    viewerRole: viewer.role,
    canComment: viewer.role === "owner" || viewer.permission === "COMMENT",
  });
}

/**
 * DELETE /api/documents/[id] — owner only.
 *
 * Removes the stored blob first, then the row. Deleting the row cascades to
 * chunks, shares, comments, and chat sessions via the schema's onDelete
 * rules, so there is no orphaned data left behind.
 *
 * Guests holding a share token must never be able to delete the document, so
 * this checks isOwner rather than merely "is authorized".
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewer = await authorizeDocument(id, request);

  // 404 rather than 403 for non-owners: a guest with a valid share token
  // should not learn that delete is a thing they were refused.
  if (!isOwner(viewer)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const document = await db.document.findUnique({
    where: { id },
    select: { blobUrl: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Best-effort blob cleanup. If the blob is already gone we still want the
  // row removed — leaving an undeletable row would be worse than an orphaned
  // blob, and the user explicitly asked for this document to disappear.
  try {
    await deletePdf(document.blobUrl);
  } catch (err) {
    console.error(`[delete ${id}] blob removal failed:`, err);
  }

  await db.document.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
