import { db } from "@/lib/db";
import { extractPdfText } from "@/lib/pdf/extract";
import { chunkPages } from "@/lib/pdf/chunk";
import { summarizeDocument } from "@/lib/ai/summarize";
import { embedChunkTexts, replaceChunks } from "@/lib/ai/embed";

/**
 * The ingest pipeline. Runs in the background AFTER the upload route has
 * already returned 201, so the user is never blocked waiting for the LLM.
 *
 *   extract text (unpdf)
 *     -> if < 200 chars: NO_TEXT (scanned/image-only PDF — don't hallucinate)
 *     -> else index for chat (chunk + embed + store), summarize, mark READY
 *   any error -> FAILED with a real message
 *
 * Every exit path writes a terminal status, so the dashboard never shows an
 * eternal spinner (docs/AI_DESIGN.md § 2, ROADMAP risk register).
 *
 * Indexing is treated as required, not best-effort: a document marked READY
 * that cannot answer a single question is a worse outcome than one that
 * honestly reports failure, since the user would only discover the gap by
 * asking and getting nothing.
 *
 * Indexing and summarization run sequentially rather than concurrently. They
 * share one free-tier quota pool, and a rate-limit error would fail an upload
 * that a few extra seconds would have completed.
 */

// Below this, the PDF is almost certainly scanned images with no text layer.
// Summarizing near-empty text just invents a document, so we refuse.
const MIN_TEXT_CHARS = 200;

export async function processDocument(
  documentId: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    const { pageCount, pages, fullText } = await extractPdfText(bytes);

    // Scanned-PDF guard.
    if (fullText.trim().length < MIN_TEXT_CHARS) {
      await db.document.update({
        where: { id: documentId },
        data: {
          status: "NO_TEXT",
          pageCount,
          extractedText: fullText,
          errorMessage:
            "This PDF appears to be scanned images. No extractable text was found, so summary and chat aren't available.",
        },
      });
      return;
    }

    const document = await db.document.findUnique({
      where: { id: documentId },
      select: { filename: true },
    });

    // Build the chat index: split into overlapping page-tagged chunks, embed
    // each one, and store both. Without this the document is readable but
    // unquestionable — retrieval has nothing to search.
    await indexDocument(documentId, pages);

    const summary = await summarizeDocument(
      document?.filename ?? "document.pdf",
      fullText,
    );

    await db.document.update({
      where: { id: documentId },
      data: {
        status: "READY",
        pageCount,
        extractedText: fullText,
        summary,
      },
    });
  } catch (err) {
    // Log the detail server-side; store a user-safe message on the row.
    console.error(`[process ${documentId}]`, err);
    await db.document
      .update({
        where: { id: documentId },
        data: {
          status: "FAILED",
          errorMessage:
            "We couldn't process this PDF. It may be corrupted or password-protected.",
        },
      })
      .catch((e) => console.error(`[process ${documentId}] status write failed`, e));
  }
}

/**
 * Chunk a document's pages, embed every chunk, and store them.
 *
 * Exported because two callers need it: the ingest pipeline above, and the
 * backfill script for documents uploaded before chat existed (which have no
 * chunks at all). replaceChunks deletes-then-inserts inside a transaction,
 * so re-running this on an already-indexed document is safe and idempotent.
 *
 * Returns the number of chunks written, purely so callers can log it.
 */
export async function indexDocument(
  documentId: string,
  pages: { pageNumber: number; text: string }[],
): Promise<number> {
  const chunks = chunkPages(pages);
  if (chunks.length === 0) return 0;

  const embeddings = await embedChunkTexts(chunks.map((c) => c.content));
  await replaceChunks(documentId, chunks, embeddings);
  return chunks.length;
}
