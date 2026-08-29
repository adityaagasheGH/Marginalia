import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { db } from "@/lib/db";
import { authorizeDocument } from "@/lib/authorize";

/**
 * GET /api/documents/[id]/file — streams the PDF bytes.
 *
 * This route is the entire reason "accessible only to the uploader and
 * explicitly invited users" is actually true rather than aspirational
 *. The blob is private; its URL is fetched server-side
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
      "Content-Disposition": contentDisposition(document.filename),
      // The PDF renders inside react-pdf's canvas, never a raw <embed>, so
      // there is no PDF-embedded-JS execution surface.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Build a Content-Disposition header that survives non-ASCII filenames.
 *
 * HTTP header values are ByteStrings — every character must fit in a single
 * byte (0-255). A filename like "Assignment — Spec.pdf" contains an em dash
 * (U+2014 = 8212), and putting it in a header raw throws
 *   "Cannot convert argument to a ByteString ... value of 8212"
 * which turns the whole PDF request into a 500.
 *
 * RFC 5987 / RFC 6266 solve this with two parameters: a plain ASCII
 * `filename` that old clients understand, plus `filename*` carrying the real
 * UTF-8 name percent-encoded. Modern browsers prefer `filename*`.
 */
function contentDisposition(filename: string): string {
  // ASCII fallback: drop anything outside printable ASCII, and quotes and
  // backslashes which would terminate or escape the quoted string.
  const ascii =
    Array.from(filename)
      .map((ch) => {
        const code = ch.charCodeAt(0);
        if (code < 32 || code > 126) return "_";
        if (ch === '"' || ch === String.fromCharCode(92)) return "_";
        return ch;
      })
      .join("")
      .trim() || "document.pdf";

  // encodeURIComponent leaves a few characters RFC 5987 wants encoded.
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );

  return `inline; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
