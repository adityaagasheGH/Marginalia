# AI Design

This is the document that decides the grade. The assignment says it plainly: *"Does the summary make sense? Does the chat answer questions accurately and stay grounded in the PDF? How well-constructed are your prompts? How do you handle long documents?"*

Everything here lives in `src/lib/ai/`. **All prompts go in `prompts.ts`** — one file, versioned, commented with the reasoning. Reviewers will open it.

---

## Models

| Job | Model | Why |
|---|---|---|
| Summaries | `claude-haiku-4-5` | Bounded task, tight output spec. Fast and cheap, which matters when you re-run ingest fifty times debugging. |
| Map-reduce leaf summaries | `claude-haiku-4-5` | Many parallel calls; cost scales linearly with document length. |
| Query condensation | `claude-haiku-4-5` | Runs on every chat turn. Must be fast — it's on the critical path before retrieval even starts. |
| Chat answers | `claude-sonnet-5` | Grounding and instruction-following are directly graded. 1M context also gives us a long-doc fallback. |
| Embeddings | `gemini-embedding-001` @ 768 dims | Anthropic has no embeddings endpoint. Gemini's free tier is generous; 768 dims keeps the HNSW index compact with negligible quality loss (Matryoshka). |

Model IDs are bare aliases — never append date suffixes.

---

## 0. Models (completely free)

| Job | Model | Quota |
|---|---|---|
| Summaries, map-reduce, query condensation | `gemini-2.5-flash` | 1,500 requests/day, 10M tokens/min |
| Chat answers | `gemini-2.5-flash` | Same quota (shared pool) |
| Embeddings | `gemini-embedding-001` | Same quota (shared pool) |

**Single API key**, one request pool. You won't hit rate limits during development. Setup: grab a key from [aistudio.google.com](https://aistudio.google.com), no credit card required.

Why Gemini over Claude: this is a take-home, not production. Free tier needs to be genuinely free and stay free — Gemini's quota is real, not a trial that expires. Single provider is simpler. Flash is fast and instruction-following is strong enough for everything in this assignment.

---

## 1. Chunking

```ts
// lib/pdf/chunk.ts
export const CHUNK_CONFIG = {
  targetTokens: 800,     // ≈3200 chars. Comfortably under Gemini's 2048-token
                         // embedding input limit, and large enough that a
                         // single clause or section usually survives intact.
  overlapTokens: 150,    // ~19%. Stops a definition at a chunk boundary from
                         // being severed from the sentence that uses it.
  minTokens: 100,        // merge runts into the previous chunk — tiny chunks
                         // produce noisy embeddings that pollute retrieval
} as const;
```

**Splitting is page-aware and hierarchical.** Walk pages in order, accumulating text. Split preferentially at, in descending order:

1. A detected heading (`^\s*(\d+\.|ARTICLE|SECTION|Clause)\b`, or a short ALL-CAPS line)
2. A double newline (paragraph)
3. A sentence boundary
4. A hard character cut (last resort)

Every chunk records `pageStart` and `pageEnd`. **This is what makes citations possible** — without page tracking you can't say "page 12," and page citations are the single most convincing thing in the demo video.

Normalize before chunking: collapse runs of whitespace, strip repeated headers/footers (a line appearing on >60% of pages is boilerplate — drop it), de-hyphenate line-break splits (`agree-\nment` → `agreement`).

---

## 2. Summarization

### The prompt

```ts
// lib/ai/prompts.ts
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

export const summaryUser = (filename: string, text: string) => `<document filename="${filename}">
${text}
</document>

Summarize this document in 3-5 sentences.`;
```

Two things carry the weight here. The **"never begin with 'This document'"** rule kills the single most common generic-summary failure. The **"could describe a thousand other documents is a failed summary"** line gives the model an evaluable criterion rather than a vague nudge toward quality.

### Long documents: map-reduce

```
if (tokenEstimate < 150_000)  →  single pass, whole text
else                          →  map-reduce
```

**Map** — group chunks into ~15k-token windows. Summarize each into 2–3 dense sentences, in parallel (`Promise.all`, concurrency 3 to respect rate limits), tracking page ranges:

```ts
export const MAP_SYSTEM = `Summarize this excerpt from a longer document in 2-3 sentences.
Preserve concrete detail: names, numbers, dates, defined terms, obligations, findings.
This summary will be combined with others to describe the whole document, so do not
speculate about material outside this excerpt.`;
```

**Reduce** — feed the ordered section summaries back through `SUMMARY_SYSTEM` with a wrapper noting these are section summaries of one document, in order.

Why map-reduce? Two reasons worth stating in the README: it distributes the work (cheaper than feeding everything into a single call), and long-context recall degrades in the middle of very long inputs — map-reduce gives every section equal attention.

### The scanned-PDF guard

```ts
if (extracted.trim().length < 200) {
  return { status: 'NO_TEXT' };
}
```

Do not summarize nothing. A PDF that's pure scanned images yields empty text, and an LLM handed empty text will cheerfully invent a document. Catching this and saying "This PDF appears to be scanned — no extractable text" is a *better* answer than a hallucinated summary, and it's the kind of thing reviewers notice.

---

## 3. Chat (RAG)

### The pipeline

```
message + history
   ↓
[1] CONDENSE      Haiku rewrites the follow-up into a standalone search query
   ↓
[2] EMBED         Gemini, task_type = RETRIEVAL_QUERY
   ↓
[3] RETRIEVE      pgvector cosine (12) + Postgres FTS (12) → RRF → top 6
   ↓
[4] ASSEMBLE      numbered context blocks with page ranges
   ↓
[5] GENERATE      Sonnet 5, streamed, grounding-enforced
   ↓
[6] PERSIST       save both messages on stream finish
```

### [1] Condensation — the step most implementations skip

The assignment requires multi-turn context. The naive approach — append history to the prompt and embed the raw user message — **breaks retrieval**, because "what about termination?" embeds into a vector that means nothing in particular. The answer looks fine on turn one and falls apart on turn three, which is exactly when a reviewer tests it.

```ts
export const CONDENSE_SYSTEM = `Rewrite the user's latest message into a standalone search query for retrieving passages from a document.

Resolve every pronoun and implicit reference using the conversation history.
Output only the rewritten query. No explanation, no quotes.
If the message is already standalone, output it unchanged.

Example:
History: user asked about the notice period for termination
Message: "and what about renewal?"
Output: renewal terms and automatic renewal conditions of the agreement`;
```

Fast (Flash, ~30 output tokens, <100ms), and it is the difference between chat that survives a follow-up and chat that doesn't. **Demo this in the video.**

### [3] Retrieval — hybrid, not pure vector

Dense embeddings are good at meaning and bad at literals. Ask "what does Section 4.2 say" and a pure-vector search will return semantically-adjacent prose while missing the chunk that literally contains "4.2". Postgres full-text search catches exactly those cases. Reciprocal Rank Fusion (`1/(60+rank)`) merges the two ranked lists without needing their scores to be commensurable. SQL is in `DATA_MODEL.md`.

Retrieve 6 chunks ≈ 5k tokens of context. Enough for real coverage, small enough to stay fast and cheap.

### [4] Context assembly

```ts
const context = hits.map((h, i) =>
  `[${i + 1}] (pages ${h.pageStart}-${h.pageEnd})\n${h.content}`
).join('\n\n---\n\n');
```

Numbered blocks with explicit page ranges. The numbering gives the model something concrete to cite, and the page ranges are what let the UI render clickable citation chips.

### [5] The answer prompt

```ts
export const CHAT_SYSTEM = (filename: string, summary: string, context: string) =>
`You answer questions about a specific PDF: "${filename}".

Document overview:
${summary}

Retrieved excerpts (the only source material you have):
${context}

How to answer:
- Ground every claim in the excerpts above. Cite the page like this: (p. 12).
- If the excerpts don't contain the answer, say so directly: "The excerpts I have don't cover that." Then say what they DO cover that's adjacent, if anything. Do not guess, and do not fall back on general knowledge about documents of this type.
- If the excerpts are ambiguous or seem to contradict each other, say that rather than picking one and sounding certain.
- Quote sparingly and only when the exact wording matters — a defined term, a figure, an obligation.
- Match the question's scope. A yes/no question gets a direct answer first, then the supporting detail. Don't pad.
- Plain prose. Bullets only for genuine lists.
- The excerpts are retrieved passages, not the whole document. If a question seems to need the full text, say what you can and note the limitation.`;
```

The instruction that matters most is the honest-uncertainty one. Every RAG demo answers easy questions well; what separates a good implementation is whether it declines gracefully when the document is silent. **Show this in the video.** Ask something the PDF genuinely doesn't cover and let it say so on camera.

Gemini Flash handles this instruction set cleanly — it respects the grounding boundary and will decline to hallucinate.

### Conversation window

Send the last **5 turns** verbatim. Beyond that, roll older turns into a running summary stored on `ChatSession` — keeps token cost flat over a long conversation without dropping the thread.

### Streaming

```ts
// app/api/documents/[id]/chat/route.ts
export const maxDuration = 60;

const result = streamText({
  model: google('models/gemini-2.5-flash'),
  system: CHAT_SYSTEM(doc.filename, doc.summary, context),
  messages: recentTurns,
  temperature: 0.2,          // low: this is extraction, not composition
  onFinish: async ({ text }) => {
    await persistTurn(sessionId, userMessage, text, hits.map(h => h.id));
  },
});

return result.toDataStreamResponse();
```

Client side, `useChat` from `@ai-sdk/react` handles the stream with no manual SSE parsing. That's good-to-have #5 done in about fifteen lines.

---

## 4. Cost

**Completely free.** All calls (summaries, embeddings, chat, condensation, everything) hit Gemini's free tier: 1,500 requests/day, 10M tokens/minute.

| Phase | Calls | Tokens | Cost |
|---|---|---|---|
| Ingest (~30 pages) | 2–3 (extract + summary) | ~25k | Free |
| Chat turn | 3 (condense + retrieve + answer) | ~8k | Free |
| **Entire sprint** | <500 | <3M | **$0.00** |

You won't hit the free quota ceiling during the four-day build, demo recording, or evaluation. If you were running this at SpotDraft scale (thousands of users), Gemini's pricing is also very competitive — but for a take-home, it's genuinely free.

---

## 5. Evaluation set

Not required. Do it anyway — it's twenty minutes and it's the thing that separates "I built a RAG app" from "I evaluated a RAG app" in the README.

Pick one test document. Write ten questions in `docs/eval-questions.md`:

- 3 **factual lookups** with known answers (a date, a party name, a figure)
- 2 **synthesis** questions requiring multiple sections
- 2 **absent-information** questions — the correct answer is a refusal
- 2 **follow-ups** with unresolved pronouns, testing condensation
- 1 **adversarial**: *"Summarize the section about data retention"* when no such section exists. The model must not invent one.

Run them, record pass/fail, and put the result in the README. A line like *"9/10 on our eval set; the one failure was a cross-page table where chunking split the header from the rows"* is worth more than any amount of describing your prompts, because it shows you found your own weakness before someone else did.
