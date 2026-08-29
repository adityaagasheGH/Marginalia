# Marginalia

Upload a PDF, get an AI summary, ask it questions, and share it for comments — the people you invite don't need an account.

---

## Features

| | |
|---|---|
| **Auth** | Email + password. Auth.js credentials, bcrypt cost 12, JWT sessions |
| **Upload** | Magic-byte validated, 25 MB cap, private blob storage |
| **Dashboard** | Your documents with AI summaries — *no search yet* |
| **Summary** | Generated on upload; refuses to summarize scanned PDFs rather than inventing one |
| **Chat** | Hybrid RAG over the document, streamed, multi-turn, cites page numbers |
| **Reader** | Continuous-scroll PDF viewer, jump-to-page, zoom |
| **Sharing** | One link, revocable instantly. Guests read and comment with no account |
| **Comments** | Threaded one level, with **bold** / *italic* / bullets |
| **Theme** | Light and dark, remembered per browser |

---

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 + shadcn/ui · Neon Postgres + pgvector · Prisma · Auth.js v5 · Vercel Blob · Google Gemini via the Vercel AI SDK

One app, one deploy. Every AI call runs in a server route, so the API key is never reachable from the browser.

---

## How the AI works

### Models

| Job | Model |
|---|---|
| Summaries, chat, query condensation | `gemini-flash-lite-latest` |
| Embedding chunks | `gemini-embedding-001` @ 768 dims, `RETRIEVAL_DOCUMENT` |
| Embedding questions | `gemini-embedding-001` @ 768 dims, `RETRIEVAL_QUERY` |

One API key, one free-tier quota pool.

Document vectors and query vectors must come from the same model at the same width — embeddings are only comparable inside one model's vector space, and mixing them fails silently. `document_chunks.embedding` is `vector(768)` with an HNSW index on that exact width. The two task types are asymmetric on purpose: a question and the passage answering it are worded differently, and telling Gemini which side it is embedding closes that gap.

### Ingest

```
PDF → unpdf (text per page) → chunk → embed → Postgres
                            └→ summarize
```

Under 200 characters of extracted text the document is marked `NO_TEXT` and nothing is summarized — an honest failure beats a hallucinated summary. Indexing is required for `READY`: a document that silently answers nothing is worse than one that reports failure.

### Chunking

~800 tokens with ~150-token overlap, split at headings first, then paragraphs, then sentences. Running headers and footers (any line on >60% of pages) are stripped so they don't push the same vocabulary into every embedding. Chunks under 100 tokens merge into their predecessor. Every chunk records `pageStart`/`pageEnd` — that is what makes `(p. 12)` citations possible.

### Chat

```
1. CONDENSE   follow-up + history → standalone query
2. EMBED      RETRIEVAL_QUERY
3. RETRIEVE   pgvector cosine (12) + Postgres FTS (12) → RRF → top 6
4. ASSEMBLE   numbered excerpts tagged with page ranges
5. GENERATE   temperature 0.2, streamed
6. PERSIST    both messages saved
```

**Condensation** is what makes multi-turn work. "And how long?" embeds to noise; rewritten against the history it becomes `"duration and retention period of conversation history"` and retrieves the right passage. Without it, chat looks fine on turn one and falls apart on turn three.

**Retrieval is hybrid.** Dense vectors match meaning — they find the termination clause when you ask "how do I cancel", with no shared vocabulary. They are bad at literals: ask about "Section 4.2" and vector search returns similar-feeling prose while missing the chunk that says "4.2". Postgres full-text search catches those. Reciprocal Rank Fusion (`1/(60+rank)`) merges the two lists by rank position, because a cosine distance and a `ts_rank` are not on comparable scales.

**Grounding.** The prompt requires page citations, forbids falling back on general knowledge, and requires an explicit *"the excerpts I have don't cover that"* when the document is silent. Asked about something absent, it declines and says what it does cover instead.

**Memory.** The last 5 turns go to the model verbatim. History is used twice: condensation reads it to resolve pronouns before retrieval, and the answering model reads it so replies follow naturally.

### Long documents

Chat never sends the document — it sends **six chunks, roughly 5k tokens**, regardless of length. A 1,000-page PDF costs the same per turn as a 10-page one, so there is no length at which chat stops working. The constraint shifts from "does it fit" to "did retrieval find the right passages", which is why retrieval is hybrid rather than vector-only.

Summaries are the weaker case: one pass, truncated at ~125k tokens. Map-reduce is not built.

---

## Sharing and comments

The owner generates a link that opens at `/shared/<token>` with no login. The token is 32 random bytes — the link *is* the credential — checked on every request, so revoking kills it immediately.

Guests give a display name once, stored in an **HMAC-signed httpOnly cookie** scoped to that share. Signed rather than encrypted: the name isn't secret, but it must not be forgeable, or anyone could impersonate a commenter or delete their posts. That cookie is also what lets a guest delete their own comment without an account.

Comment formatting is a markdown subset rendered to **React elements, never an HTML string**. There is no `dangerouslySetInnerHTML` anywhere, so a comment containing `<script>` displays as text — XSS is structurally impossible rather than filtered. Comments poll every 5s.

---

## Getting started

**Requires:** Node 20+, a Postgres database with the `vector` and `pg_trgm` extensions (Neon's free tier works), and a Google AI Studio API key.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

| Variable | |
|---|---|
| `DATABASE_URL` | Pooled Postgres connection |
| `DIRECT_URL` | Unpooled connection — migrations only (pgbouncer can't run DDL) |
| `AUTH_SECRET` | Signs sessions and guest cookies. `openssl rand -base64 32` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage |

### Scripts

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `start` | Production build and serve |
| `npm run check:env` | Validate `.env` without printing secrets |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Browse the database |
| `npm run clean` | Clear a corrupted Turbopack cache |
| `node scripts/backfill-chunks.mjs` | Index documents uploaded before chat existed |

> **After any `prisma migrate dev`**, re-run `prisma/migrations/*_restore_vector_and_trgm_indexes/migration.sql`. `schema.prisma` cannot express an HNSW index on an `Unsupported("vector")` column, so Prisma treats those indexes as drift and drops them. The statements are idempotent.

---

## Structure

```
src/
  app/
    (app)/           dashboard and reader (auth required)
    (auth)/          login, signup
    api/             all server routes
    shared/[token]/  public guest reader
  components/
    reader/          PDF viewer, chat, comments, share dialog
    dashboard/       upload and document cards
  lib/
    ai/              client, prompts, embed, retrieve, condense, summarize
    pdf/             extract, chunk
    authorize.ts     the single access-control chokepoint
    guest.ts         signed guest cookies
prisma/              schema and migrations
scripts/             env check, db verify, chunk backfill
```

Where the PDF lives: the file goes to **Vercel Blob** (private). Postgres stores only metadata, extracted text, chunks, and vectors.

---

## Security

- **One authorizer.** Every document route resolves its caller through `authorizeDocument()` — owner session, valid share token, or nothing.
- **404, never 403.** An unauthorized caller cannot learn that a document exists.
- **Keys stay server-side.** The browser never talks to Gemini and never receives a blob URL; PDFs stream through an authorized route.
- **Blob paths are server-generated** (`ownerId/documentId.pdf`), never built from a filename.
- **Uploads are magic-byte checked** (`%PDF-`), not trusted by MIME type.
- **Guest cookies are HMAC-signed**, `httpOnly`, and compared in constant time.
- **Prompt injection** is bounded: document text is delimited and labelled untrusted, and the model has no tools — the worst case is a bad answer, not an action.
