import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeDocument } from "@/lib/authorize";

/**
 * GET /api/documents/[id] — metadata for the reader page.
 *
 * Resolves the caller through authorizeDocument (the single chokepoint) and
 * returns 404 — never 403 — when they have no claim on the document, so an
 * unauthorized request can't even confirm the id exists (docs/API_SPEC.md).
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
