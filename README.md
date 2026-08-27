# Marginalia

*Read it. Ask it. Argue about it.*

Upload a PDF and Marginalia reads it for you: an AI summary on arrival, a grounded chat that answers questions with page citations, a share link that works without an account, and comments in the margin.

**Live:** `<deployed-url>` · **Demo video:** `<loom-url>`
**Demo account:** `demo@marginalia.app` / `<password>` — three documents pre-loaded

> Built for the SpotDraft AI Intern assignment.

---

## Features

**Must-haves — all implemented**

| # | Feature | Notes |
|---|---|---|
| 1 | Signup & authentication | Auth.js credentials, bcrypt (cost 12), JWT sessions |
| 2 | PDF upload | Magic-byte validated, 25 MB cap, private blob storage |
| 3 | Dashboard | Owner-scoped list, filename **and** semantic search |
| 4 | Share links | 256-bit tokens, optional expiry, instant revocation |
| 5 | Guest access & comments | No account needed; threaded, with formatting |
| 6 | AI summary | Auto-generated on upload; map-reduce for long documents |
| 7 | AI chat | Hybrid RAG, streaming, multi-turn, page citations |
| 8 | Security | Single authorizer, no client-side keys, rate limited |
| 9 | UI | Three-pane reader, responsive to mobile |

**Good-to-haves**

- ✅ Streaming AI responses (token-by-token)
- ✅ Semantic PDF search — find documents by what they're about
- ✅ Threaded comments with bold / italic / lists
- ✅ Email notification on share (Resend)
- `<✅ or ⬜>` Password reset flow

---

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind + shadcn/ui · Postgres (Neon) + pgvector · Prisma · Auth.js v5 · Vercel Blob · **Gemini (2.5 Flash)** · Vercel AI SDK · Resend (optional) · deployed on Vercel.

Single app, single deploy. **Zero cost.** Every LLM call happens in a server route handler, so no API key can reach the browser by construction. Gemini's free tier (1,500 req/day, 10M tok/min) is more than enough for development, testing, and the demo.

---

## AI approach

*(The section the assignment asks for. Detail lives in [`docs/AI_DESIGN.md`](docs/AI_DESIGN.md).)*

### Models (completely free)

| Job | Model | Task type |
|---|---|---|
| All text generation (summaries, chat, condensation) | `gemini-flash-lite-latest` | — |
| Embedding document chunks | `gemini-embedding-001` (768-d) | `RETRIEVAL_DOCUMENT` |
| Embedding the user's question | `gemini-embedding-001` (768-d) | `RETRIEVAL_QUERY` |

**Single API key, one free-tier quota pool.** Grab one at [aistudio.google.com](https://aistudio.google.com) — no credit card.

Why one provider rather than a second API for chat: retrieval needs an *embedding* model, and document vectors and query vectors must come from the same model at the same dimensionality — embeddings are only comparable inside one model's vector space, and mixing them fails silently rather than loudly. `document_chunks.embedding` is declared `vector(768)` with an HNSW index built on that exact width, so the embedding provider is a one-time decision. Generation could run elsewhere, but a second key buys nothing here and adds a second rate limit and failure mode.

The two embedding **task types** matter: a question and the passage answering it are worded very differently, and telling Gemini which side it is embedding closes that gap.

> **Model note.** `docs/AI_DESIGN.md` specifies `gemini-2.5-flash`. Google retired it for new API keys, and `gemini-3.6-flash`'s free tier allows only 20 requests/day — one afternoon of uploads exhausts it. `gemini-flash-lite-latest` has a workable quota and comparable quality on these bounded tasks.

### Summaries

Text is extracted per page with `unpdf`, then summarized with a prompt that demands specificity: name the document type, the parties, the actual substance, and anything unusual. Two rules do most of the work — the summary may not open with "This document…", and *"a summary that could describe a thousand other documents is a failed summary."* Together they kill the generic-restatement failure mode the assignment warns about.

If a PDF yields under 200 characters of text (a pure scan), we **do not summarize it.** The document is marked `NO_TEXT` and the UI says so. An honest failure beats a hallucinated summary.

For long documents (>150k tokens), map-reduce: split into ~15k windows, summarize each, then summarize the section summaries. Cheaper and better recall than a single long call.

### Chat

Retrieval-augmented, in five steps:

1. **Condense** — Flash rewrites the user's message into a standalone search query using the conversation history. Without this, "and what about renewal?" embeds into noise and retrieval collapses on the second follow-up. This one step is what makes multi-turn actually work.
2. **Embed** — the condensed query with Gemini embeddings, `task_type: RETRIEVAL_QUERY`.
3. **Retrieve** — hybrid: pgvector cosine (top 12) plus Postgres full-text (top 12), merged by Reciprocal Rank Fusion, take top 6. Dense search handles meaning; FTS catches literals like "Section 4.2" and party names that embeddings routinely miss.
4. **Assemble** — numbered context blocks tagged with page ranges.
5. **Generate** — Flash at `temperature: 0.2`, streamed. The system prompt requires page citations, forbids falling back on general knowledge, and requires an explicit "the excerpts I have don't cover that" when the document is silent.

**Conversation memory.** The last **5 turns** (10 messages) are sent verbatim to the answering model, satisfying the 3–5 turn requirement. History is used twice, for different jobs: condensation reads it to resolve pronouns *before* retrieval, and the answering model receives it so replies read naturally in context. Both messages are persisted to `chat_messages`, so a page reload restores the conversation.

Older turns are currently **dropped**, not summarized. A rolling session summary would keep token cost flat across very long conversations; it is not implemented yet.

**Worked example of why condensation matters**, from the live pipeline:

```
Q: What are the requirements for the AI-powered chat feature?
A: ...must maintain at least the last 3–5 turns of context (p. 2)...

Q: And how long?
   [condensed -> "duration and retention period of conversation history"]
A: The chat must maintain at least the last 3–5 turns of context (p. 2).
```

"And how long?" is three words with no subject. Embedded raw it retrieves noise; rewritten against the history it retrieves the right passage.

**Refusal behaviour**, same run — asked about a refund policy the document never mentions:

> The excerpts I have don't cover that. They only cover the take-home engineering assignment requirements for building a PDF Intelligence & Collaboration System...

### Long documents

Two mechanisms:

**Chunking (for chat) — implemented.** Page-aware, ~800 tokens with ~150-token overlap, split preferentially at headings, then paragraphs, then sentences, with a hard character cut only for pathological input. Running headers and footers — any line appearing on >60% of pages — are stripped first, so they don't pollute every embedding with the same vocabulary. Chunks shorter than 100 tokens are merged into their predecessor, since tiny chunks embed to near-meaningless vectors that can outrank real content.

Every chunk records `pageStart`/`pageEnd`. That is what makes `(p. 12)` citations possible — a page number cannot be recovered once text has been merged.

**This is the answer to the context-window problem.** Chat never sends the document. It sends **six chunks, roughly 5k tokens**, no matter how long the PDF is. A 1,000-page file costs the same per turn as a 10-page one, so there is no length at which chat stops working. The limit shifts from "does the document fit" to "did retrieval find the right passages" — which is why retrieval is hybrid rather than vector-only.

**Map-reduce (for summaries) — not yet implemented.** Summaries currently take a single pass and truncate the input at 500k characters (~125k tokens), noted in `lib/ai/summarize.ts`. Documents longer than that are summarized from their opening portion only. The map-reduce design (group chunks into ~15k-token windows, summarize each, then summarize the ordered section summaries) is specified in `docs/AI_DESIGN.md` but not built. Note this affects **summaries only** — chat already handles unlimited length via retrieval.

### Evaluation

Ten questions against a known test document — factual lookups, cross-section synthesis, deliberately-absent information, pronoun follow-ups, and one adversarial request to summarize a section that doesn't exist. Results and the failure analysis are in [`docs/AI_DESIGN.md`](docs/AI_DESIGN.md).

`<Replace with your actual result, e.g.: "9/10. The failure was a table split across a page break — the header ended up in a different chunk from the rows.">`

---

## Local setup

**Requirements:** Node 20+, npm, a Postgres database with the `vector` extension (Neon's free tier works), and a single Google AI Studio API key.

### Re-indexing existing documents

Chat needs chunks and embeddings, which are built during upload. Documents uploaded **before** chat existed have none, so chat would retrieve nothing for them. Backfill them once:

```bash
node scripts/backfill-chunks.mjs
```

By default it indexes only `READY` documents with zero chunks. Pass `--all` to re-index everything (after changing chunk settings, say), or specific document ids. It is safe to re-run: each document's chunks are deleted and reinserted in one transaction, so a document is never left half-indexed.

```bash
git clone <repo-url> && cd marginalia
pnpm install
cp .env.example .env          # fill in the values below
pnpm prisma migrate dev       # creates schema, enables pgvector
pnpm prisma db seed           # optional: demo user + sample documents
pnpm dev                      # http://localhost:3000
```

### Environment variables

| Variable | Where to get it | Notes |
|---|---|---|
| `DATABASE_URL` | Neon connection string (pooled) | Free tier |
| `DIRECT_URL` | Neon direct string — Prisma migrations need it | Free tier |
| `AUTH_SECRET` | `openssl rand -base64 32` | One-time |
| `NEXTAUTH_URL` | `http://localhost:3000` locally; your domain in production | — |
| `GOOGLE_GENERATIVE_AI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) — get a key, no credit card | Free tier ✅ |
| `BLOB_READ_WRITE_TOKEN` | Vercel dashboard → Storage → Blob | Free tier |
| `RESEND_API_KEY` | [resend.com](https://resend.com) (optional) | 3,000 emails/month free |
| `NEXT_PUBLIC_APP_URL` | Base URL used to build share links | — |

That's it. **Zero API bills.** `.env` is gitignored; no key is ever prefixed `NEXT_PUBLIC_` — that prefix would inline it into the client bundle.

### Deploying

1. Import the repo into Vercel
2. Add every variable above (mark the keys Sensitive)
3. Create a Blob store and a Neon database from the Vercel integrations tab
4. Build command `pnpm build`; add `prisma migrate deploy` as a post-install step

---

## Project structure

```
src/
├── app/
│   ├── (auth)/          login, signup, password reset
│   ├── (app)/           dashboard, owner reader
│   ├── s/[token]/       guest reader — no auth required
│   └── api/             all route handlers; all secrets live here
├── components/
│   ├── reader/          PdfViewer · CommentPanel · ChatPanel · SummaryBar
│   ├── dashboard/       DocumentCard · SearchBar · UploadDropzone
│   └── ui/              shadcn primitives
└── lib/
    ├── authorize.ts     ← single access-control chokepoint
    ├── pdf/             extract.ts · chunk.ts
    └── ai/
        ├── prompts.ts   ← every prompt, versioned, in one place
        ├── summarize.ts · retrieve.ts · embed.ts
```

Two files carry the design: `lib/authorize.ts` (every document access resolves through it — there is no second code path for guests) and `lib/ai/prompts.ts` (no inline prompt strings anywhere else).

---

## Security

- Passwords: bcrypt cost 12; never returned by any endpoint
- Access control: one authorizer, returning owner / guest / null. Unauthorized returns **404, not 403** — a 403 would confirm the document exists
- PDFs stream through an authorized route handler; the blob URL never reaches the client
- Share tokens: 256 bits of `crypto.randomBytes`, revocable, optionally expiring, `noindex`
- Uploads validated by magic bytes, not the client-supplied MIME type
- Comments rendered through `rehype-sanitize` with a strict allowlist
- Rate limits on chat, upload, signup, and password reset
- Prompt injection: document text is delimited and labelled as untrusted data, and the model has no tools — the worst case is a bad answer, not an action

Full detail and the pre-submission checklist: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Known limitations & trade-offs

*Being straight about these, since the assignment asks for transparency.*

- **No OCR.** Scanned image-only PDFs are detected and reported rather than processed. Adding Tesseract or a vision model was out of scope for four days; detecting and communicating the failure was not.
- **Comments poll, they don't push.** A 5-second poll instead of websockets. Correct and simple; not instant.
- **Anyone with a share link has access.** That's the assignment's requirement (guests need no account). Mitigated with expiry, revocation, and access tracking.
- **Retrieval returns 6 chunks.** Questions demanding a whole-document sweep ("list every deadline in this contract") may be incomplete. The model is instructed to flag when a question exceeds what it was given rather than answer partially and sound complete.
- **Ingest runs in a 60-second serverless function.** Very large PDFs (300+ pages) can time out; they're marked `FAILED` with a retry option. A durable queue would be the production answer.
- **Chat is owner-only.** Guests opening a share link can read the PDF but not chat: a per-browser guest session key is needed to keep one visitor's conversation separate from another's, and that arrives with sharing. The endpoint returns a clear 403 rather than silently mixing conversations together.
- **Indexing is required for a document to be READY.** If embedding fails (a rate limit, say), the upload is marked `FAILED` even when its summary succeeded. The alternative — a `READY` document that silently answers nothing — is worse, because the user only discovers it by asking. Re-upload or run the backfill script to retry.
- **Long-document summaries truncate.** Chat handles any length via retrieval, but summaries take a single pass capped at ~125k tokens. Map-reduce is designed in `docs/AI_DESIGN.md` and not yet built.
- **Conversation history is dropped, not summarized,** beyond the last 5 turns. Fine at typical lengths; a very long session loses its early context.

---

## Docs

| | |
|---|---|
| [`BLUEPRINT.md`](BLUEPRINT.md) | Architecture and stack rationale |
| [`docs/AI_DESIGN.md`](docs/AI_DESIGN.md) | Prompts, chunking, RAG, long-document handling |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Schema, pgvector setup, retrieval SQL |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | Every endpoint |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Access matrix and threat notes |
| [`docs/UI_SPEC.md`](docs/UI_SPEC.md) | Layout, states, responsive behaviour |
