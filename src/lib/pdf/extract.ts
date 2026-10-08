import { extractText, getDocumentProxy, getResolvedPDFJS } from "unpdf";

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
  /** True if the page paints raster images (scan, photo, screenshot). */
  hasImages?: boolean;
  /** True if the text came from OCR rather than the PDF's text layer. */
  ocr?: boolean;
};

export type ExtractResult = {
  pageCount: number;
  pages: PageText[];
  /** All pages joined, for summarization and the length/scan guard. */
  fullText: string;
};

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractResult> {
  // pdf.js takes ownership of the buffer it is given, so hand it a copy; the
  // OCR step needs the original bytes afterwards.
  const pdf = await getDocumentProxy(bytes.slice());
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const imagePages = await detectImagePages(pdf, totalPages);

  const pages: PageText[] = text.map((pageText, i) => ({
    pageNumber: i + 1,
    text: normalize(pageText),
    hasImages: imagePages.has(i + 1),
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

/** Which pages paint raster images? Failures degrade to "unknown" (no images). */
async function detectImagePages(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  totalPages: number,
): Promise<Set<number>> {
  const found = new Set<number>();
  try {
    const { OPS } = await getResolvedPDFJS();
    const imageOps = new Set<number>([
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject,
    ]);
    for (let n = 1; n <= totalPages; n++) {
      const page = await pdf.getPage(n);
      const { fnArray } = await page.getOperatorList();
      if (fnArray.some((fn: number) => imageOps.has(fn))) found.add(n);
      page.cleanup();
    }
  } catch (err) {
    console.error("[extract] image detection failed:", err);
  }
  return found;
}
