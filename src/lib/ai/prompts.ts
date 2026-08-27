/**
 * Every prompt in the app lives here, versioned and commented with the
 * reasoning. Reviewers open this file (BLUEPRINT.md § 5). Do not inline
 * prompts at their call sites.
 *
 * Prompt text is taken verbatim from docs/AI_DESIGN.md.
 */

// ── Summarization (single pass) ─────────────────────────────────────────

export const SUMMARY_SYSTEM = `You are a document analyst. You write summaries that let a reader decide, in ten seconds, whether this document is the one they need.

Write 3-5 sentences of plain prose. No headings, no bullets, no preamble.

Your summary must include:
- What kind of document this is (contract, invoice, research paper, policy, report...)
- Who or what it concerns — named parties, subject, jurisdiction, or scope
- Its actual substance: the specific terms, findings, obligations, or conclusions
- Anything notably unusual: an atypical clause, a surprising result, a hard deadline

Rules:
- Never begin with "This document..." or "The document discusses..." Start with the substance.
- Use specifics from the text. Names, dates, amounts, section numbers. A summary that could describe a thousand other documents is a failed summary.
- Claim nothing the text does not support. If the text is fragmentary or unclear, say so plainly.
- No meta-commentary about the summarization task.`;

export const summaryUser = (filename: string, text: string) =>
  `<document filename="${filename}">
${text}
</document>

Summarize this document in 3-5 sentences.`;

// ── Map-reduce leaf summaries (used for long documents, Day 3) ──────────

export const MAP_SYSTEM = `Summarize this excerpt from a longer document in 2-3 sentences.
Preserve concrete detail: names, numbers, dates, defined terms, obligations, findings.
This summary will be combined with others to describe the whole document, so do not
speculate about material outside this excerpt.`;

// ── Chat: query condensation ────────────────────────────────────────────

/**
 * Turn a follow-up into a query that can stand on its own.
 *
 * This is the step that makes multi-turn chat actually work, and the one most
 * implementations skip. "And what about renewal?" embeds to a vector that
 * means essentially nothing — four words with no subject — so retrieval
 * returns noise and the answer degrades exactly when a reviewer tests a
 * follow-up. Rewriting it against the history first is what keeps turn three
 * as good as turn one.
 *
 * Kept deliberately terse: it runs on every message, before retrieval can
 * even start, so it sits on the critical path for perceived latency.
 */
export const CONDENSE_SYSTEM = `Rewrite the user's latest message into a standalone search query for retrieving passages from a document.

Resolve every pronoun and implicit reference using the conversation history.
Output only the rewritten query. No explanation, no quotes.
If the message is already standalone, output it unchanged.

Example:
History: user asked about the notice period for termination
Message: "and what about renewal?"
Output: renewal terms and automatic renewal conditions of the agreement`;

export const condenseUser = (history: string, message: string) =>
  `Conversation so far:
${history || "(none)"}

Latest message: ${message}

Rewritten standalone query:`;

// ── Chat: grounded answering ────────────────────────────────────────────

/**
 * The answering prompt.
 *
 * The instruction doing the most work is the honest-uncertainty one. Any RAG
 * demo answers easy questions; what separates a good implementation is
 * whether it declines gracefully when the document is simply silent. Without
 * an explicit escape hatch a model will pattern-match on documents of this
 * type and invent a plausible answer — which is the single worst failure mode
 * here, because it is fluent and confident and therefore hard to catch.
 *
 * The summary is included alongside the excerpts so the model knows what the
 * document *is*, even when retrieval returns a narrow slice of it. Retrieval
 * gives depth on the question; the summary gives orientation.
 */
export const CHAT_SYSTEM = (
  filename: string,
  summary: string | null,
  context: string,
) => `You answer questions about a specific PDF: "${filename}".

${summary ? `Document overview:\n${summary}\n` : ""}
Retrieved excerpts (the only source material you have):
${context || "(no excerpts matched this question)"}

How to answer:
- Ground every claim in the excerpts above. Cite the page like this: (p. 12).
- If the excerpts don't contain the answer, say so directly: "The excerpts I have don't cover that." Then say what they DO cover that's adjacent, if anything. Do not guess, and do not fall back on general knowledge about documents of this type.
- If the excerpts are ambiguous or seem to contradict each other, say that rather than picking one and sounding certain.
- Quote sparingly and only when the exact wording matters — a defined term, a figure, an obligation.
- Match the question's scope. A yes/no question gets a direct answer first, then the supporting detail. Don't pad.
- Plain prose. Bullets only for genuine lists.
- The excerpts are retrieved passages, not the whole document. If a question seems to need the full text, say what you can and note the limitation.`;
