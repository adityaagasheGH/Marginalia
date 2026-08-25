import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { db } from "@/lib/db";
import { authorizeDocument } from "@/lib/authorize";

/**
 * GET /api/documents/[id]/file — streams the PDF bytes.
 *
 * This route is the entire reason "accessible only to the uploader and
 * explicitly invited users" is actually true rather than aspirational
 * (docs/API_SPEC.md). The blob is private; its URL is fetched server-side
 * and never handed to the browser — the client only ever sees this route.
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
    select: { blobUrl: true, filename: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const result = await get(document.blobUrl, { access: "private" });
  if (!result || result.statusCode !== 200) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": "application/pdf",
      // inline: renders in the browser/viewer rather than forcing a download.
      "Content-Disposition": `inline; filename="${document.filename.replace(/"/g, "")}"`,
      // The PDF renders inside react-pdf's canvas, never a raw <embed>, so
      // there is no PDF-embedded-JS execution surface (docs/SECURITY.md § 5).
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
