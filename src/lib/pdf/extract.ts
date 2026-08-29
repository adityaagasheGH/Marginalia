import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extract text from a PDF, one entry per page.
 *
 * unpdf is pdf.js compiled for serverless — no native binaries, works on
 * Vercel's runtime. We keep text per-page because page
 * numbers are what make citations possible later ("p. 12").
 */

export type PageText = {
  pageNumber: number; // 1-based
  text: string;
};

export type ExtractResult = {
  pageCount: number;
  pages: PageText[];
  /** All pages joined, for summarization and the length/scan guard. */
  fullText: string;
};

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractResult> {
  // getDocumentProxy parses the PDF once; extractText then reads it.
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pages: PageText[] = text.map((pageText, i) => ({
    pageNumber: i + 1,
    text: normalize(pageText),
  }));

  return {
    pageCount: totalPages,
    pages,
    fullText: pages.map((p) => p.text).join("\n\n").trim(),
  };
}

/**
 * Light normalization: collapse runs of whitespace and repair words split
 * across a line break ("agree-\nment" -> "agreement"). Heavier cleanup
 * (header/footer stripping) comes with chunking on Day 2.
 */
function normalize(text: string): string {
  return text
    .replace(/([A-Za-z])-\n([a-z])/g, "$1$2") // de-hyphenate line breaks
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
