import { db } from "@/lib/db";
import { extractPdfText } from "@/lib/pdf/extract";
import { summarizeDocument } from "@/lib/ai/summarize";

/**
 * The ingest pipeline. Runs in the background AFTER the upload route has
 * already returned 201, so the user is never blocked waiting for the LLM.
 *
 *   extract text (unpdf)
 *     -> if < 200 chars: NO_TEXT (scanned/image-only PDF — don't hallucinate)
 *     -> else summarize (Gemini) and mark READY
 *   any error -> FAILED with a real message
 *
 * Every exit path writes a terminal status, so the dashboard never shows an
 * eternal spinner (docs/AI_DESIGN.md § 2, ROADMAP risk register).
 */

// Below this, the PDF is almost certainly scanned images with no text layer.
// Summarizing near-empty text just invents a document, so we refuse.
const MIN_TEXT_CHARS = 200;

export async function processDocument(
  documentId: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    const { pageCount, fullText } = await extractPdfText(bytes);

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
