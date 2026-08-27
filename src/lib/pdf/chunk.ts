import type { PageText } from "@/lib/pdf/extract";

/**
 * Split a document's per-page text into overlapping, page-tagged chunks.
 *
 * A "chunk" is one retrievable unit. Retrieval can only ever return whole
 * chunks, so chunk boundaries decide what the chat model is able to see.
 * Three properties matter (docs/AI_DESIGN.md § 1):
 *
 *   1. Size       — ~800 tokens. Small enough that six fit in a prompt
 *                   cheaply, large enough that a clause or section usually
 *                   survives intact.
 *   2. Overlap    — ~150 tokens repeated across each seam. Without it a
 *                   definition split by a boundary becomes unfindable,
 *                   because neither neighbour holds the whole thought.
 *   3. Provenance — every chunk records its page range. This is what makes
 *                   "(p. 12)" citations possible; a page number cannot be
 *                   recovered once the text has been merged.
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

/**
 * Tokens are what the embedding API actually limits, but tokenizing properly
 * means shipping the model's vocabulary. For sizing decisions the standard
 * approximation — ~4 characters per token of English prose — is close enough,
 * and it errs high on purpose so we land under the input limit, not over it.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A paragraph- or sentence-sized piece of text, still tied to its page. */
type Unit = { text: string; page: number; tokens: number; isHeading: boolean };

/**
 * Lines repeating on most pages are running headers/footers ("CONFIDENTIAL",
 * a page number, the document title). They carry no information, they push
 * the same vocabulary into every embedding, and they waste each chunk's token
 * budget. Drop any line appearing on more than 60% of pages.
 *
 * Guarded to 4+ page documents: on a 2-page document "appears on >60% of
 * pages" is meaningless and would delete real content.
 */
function stripBoilerplate(pages: PageText[]): PageText[] {
  if (pages.length < 4) return pages;

  const pagesContainingLine = new Map<string, number>();
  for (const page of pages) {
    // A Set, so a line repeated twice on one page still counts once.
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

/**
 * Headings are the best available split point: the text beneath one belongs
 * together, and a chunk starting at a heading reads as a coherent passage.
 * Matches numbered clauses ("4.2", "ARTICLE III", "Section 7") and short
 * all-caps lines, which is how most contracts and reports mark sections.
 */
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

/**
 * Break one page into units no larger than targetTokens, cutting at the
 * strongest boundary available: paragraph, then sentence, then a hard
 * character cut. The hard cut exists only for pathological input (a table
 * dumped as one unbroken line) and is the sole case where we knowingly
 * sever a sentence.
 */
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

    // Oversized paragraph: fall back to sentences. The lookbehind keeps each
    // terminator attached to the sentence it ends.
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
 * Assemble units into chunks, carrying an overlap tail across each boundary.
 *
 * A chunk closes when the next unit would push it past the target, or when a
 * heading arrives and the chunk is already substantial — splitting slightly
 * early at a real section break beats splitting on size mid-section.
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
      // A heading opens a genuinely new section, so carrying the previous
      // section's tail into it would blur the boundary we just honoured.
      current = unit.isHeading ? [] : overlapTail();
      currentTokens = current.reduce((n, u) => n + u.tokens, 0);
    }

    current.push(unit);
    currentTokens += unit.tokens;
  }
  flush();

  return mergeRunts(chunks);
}

/**
 * A tiny trailing chunk ("Signed: ______") embeds to a vector that means
 * almost nothing and can outrank real content by accident. Fold any
 * undersized chunk into its predecessor.
 */
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
