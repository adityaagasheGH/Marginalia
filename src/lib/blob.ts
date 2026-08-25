import { put, del, type PutBlobResult } from "@vercel/blob";

/**
 * Vercel Blob storage for PDF bytes.
 *
 * Blobs are PRIVATE: they require authentication to fetch, so the raw blob
 * URL is never a back door. PDFs are streamed to the client only through the
 * authorized route handler (Day 2), never by handing out the URL
 * (docs/SECURITY.md § 5). The pathname is server-generated — never built from
 * the user's filename — so a crafted filename cannot escape its prefix.
 */

export async function uploadPdf(
  ownerId: string,
  documentId: string,
  bytes: Uint8Array,
): Promise<PutBlobResult> {
  const pathname = `${ownerId}/${documentId}.pdf`;
  // @vercel/blob's put wants a Buffer/Blob/stream, not a bare Uint8Array.
  return put(pathname, Buffer.from(bytes), {
    access: "private",
    contentType: "application/pdf",
    // The random suffix is redundant with private access but harmless; we
    // want the pathname to be exactly ownerId/documentId for later lookup.
    addRandomSuffix: false,
  });
}

export async function deletePdf(url: string): Promise<void> {
  await del(url);
}
