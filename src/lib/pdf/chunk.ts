import type { PageText } from "@/lib/pdf/extract";

/**
 * Split per-page text into overlapping, page-tagged chunks.
 *
 * Overlap keeps a definition split across a boundary findable. Page ranges
 * are what make "(p. 12)" citations possible — they cannot be recovered
 * once text is merged.
 */

export const CHUNK_CONFIG = {
  targetTokens: 800,
  overlapTokens: 150,
  minTokens: 100,
} as const;

export type Chunk = {
  content: string;
  pageStart: number;
  pageEnd: number;
  tokenCount: number;
};

/** ~4 chars per token. Errs high so we land under the embedding input limit. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A paragraph- or sentence-sized piece, still tied to its page. */
type Unit = { text: string; page: number; tokens: number; isHeading: boolean };

/**
 * Drop running headers/footers — any line on >60% of pages. They push the
 * same vocabulary into every embedding. Guarded to 4+ page documents.
 */
function stripBoilerplate(pages: PageText[]): PageText[] {
  if (pages.length < 4) return pages;

  const pagesContainingLine = new Map<string, number>();
  for (const page of pages) {

    const seen = new Set(
      page.text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l.length < 120),
    );
    for (const line of seen) {
      pagesContainingLine.set(line, (pagesContainingLine.get(line) ?? 0) + 1);
    }
  }

  const threshold = pages.length * 0.6;
  const boilerplate = new Set(
    [...pagesContainingLine.entries()]
      .filter(([, count]) => count > threshold)
      .map(([line]) => line),
  );

  if (boilerplate.size === 0) return pages;

  return pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: page.text
      .split("\n")
      .filter((l) => !boilerplate.has(l.trim()))
      .join("\n")
      .trim(),
  }));
}

/** Numbered clauses ("4.2", "ARTICLE III") and short all-caps lines. */
function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 100) return false;
  if (
    /^\s*(\d+(\.\d+)*\.?|ARTICLE|SECTION|Clause|Appendix|Schedule|Exhibit)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Short, all-caps, and not ending like a sentence.
  return (
    t === t.toUpperCase() && /[A-Z]/.test(t) && t.length < 60 && !/[.?!]$/.test(t)
  );
}

/** Split a page into units, cutting at paragraph, then sentence, then chars. */
function pageToUnits(page: PageText): Unit[] {
  const max = CHUNK_CONFIG.targetTokens;
  const units: Unit[] = [];

  const push = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    units.push({
      text: trimmed,
      page: page.pageNumber,
      tokens: estimateTokens(trimmed),
      isHeading: isHeadingLine(trimmed.split("\n")[0]),
    });
  };

  for (const paragraph of page.text.split(/\n\s*\n/)) {
    if (paragraph.trim().length === 0) continue;

    if (estimateTokens(paragraph) <= max) {
      push(paragraph);
      continue;
    }

    // Lookbehind keeps the terminator attached to its sentence.
    let buffer = "";
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      if (estimateTokens(sentence) > max) {
        if (buffer) {
          push(buffer);
          buffer = "";
        }
        for (let i = 0; i < sentence.length; i += max * 4) {
          push(sentence.slice(i, i + max * 4));
        }
        continue;
      }
      if (estimateTokens(`${buffer} ${sentence}`) > max) {
        push(buffer);
        buffer = sentence;
      } else {
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
      }
    }
    if (buffer) push(buffer);
  }

  return units;
}

/**
 * Assemble units into chunks, carrying an overlap tail across each seam.
 * Closes early at a heading rather than splitting mid-section on size.
 */
export function chunkPages(pages: PageText[]): Chunk[] {
  const units = stripBoilerplate(pages).flatMap(pageToUnits);
  if (units.length === 0) return [];

  const chunks: Chunk[] = [];
  let current: Unit[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const content = current.map((u) => u.text).join("\n\n");
    chunks.push({
      content,
      pageStart: current[0].page,
      pageEnd: current[current.length - 1].page,
      tokenCount: estimateTokens(content),
    });
  };

  /** Trailing units of the chunk just closed, up to the overlap budget. */
  const overlapTail = (): Unit[] => {
    const tail: Unit[] = [];
    let tokens = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      if (tokens + current[i].tokens > CHUNK_CONFIG.overlapTokens) break;
      tail.unshift(current[i]);
      tokens += current[i].tokens;
    }
    return tail;
  };

  for (const unit of units) {
    const wouldExceed = currentTokens + unit.tokens > CHUNK_CONFIG.targetTokens;
    const headingBreak =
      unit.isHeading && currentTokens > CHUNK_CONFIG.targetTokens / 2;

    if (current.length > 0 && (wouldExceed || headingBreak)) {
      flush();
      // A heading opens a new section; carrying a tail in would blur it.
      current = unit.isHeading ? [] : overlapTail();
      currentTokens = current.reduce((n, u) => n + u.tokens, 0);
    }

    current.push(unit);
    currentTokens += unit.tokens;
  }
  flush();

  return mergeRunts(chunks);
}

/** Tiny chunks embed to near-meaningless vectors; fold them into the previous. */
function mergeRunts(chunks: Chunk[]): Chunk[] {
  const out: Chunk[] = [];
  for (const chunk of chunks) {
    const prev = out[out.length - 1];
    if (prev && chunk.tokenCount < CHUNK_CONFIG.minTokens) {
      const content = `${prev.content}\n\n${chunk.content}`;
      out[out.length - 1] = {
        content,
        pageStart: prev.pageStart,
        pageEnd: chunk.pageEnd,
        tokenCount: estimateTokens(content),
      };
    } else {
      out.push(chunk);
    }
  }
  return out;
}
