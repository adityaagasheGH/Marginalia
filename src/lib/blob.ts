import { put, del, type PutBlobResult } from "@vercel/blob";

/**
 * Blobs are private: the URL is never handed to the browser, and PDFs are
 * streamed only through the authorized route handler. The pathname is
 * server-generated, never built from a user-supplied filename.
 */
export async function uploadPdf(
  ownerId: string,
  documentId: string,
  bytes: Uint8Array,
): Promise<PutBlobResult> {
  return put(`${ownerId}/${documentId}.pdf`, Buffer.from(bytes), {
    access: "private",
    contentType: "application/pdf",
    addRandomSuffix: false,
  });
}

export async function deletePdf(url: string): Promise<void> {
  await del(url);
}
