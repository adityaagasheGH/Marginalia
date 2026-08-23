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

| Job | Model | Quota |
|---|---|---|
| All text generation (summaries, chat, condensation) | `gemini-2.5-flash` | 1,500 req/day, 10M tok/min |
| Embeddings | `gemini-embedding-001` (768-d) | Same free quota |

Single API key, one free-tier quota pool. No trial credits, no expiry, no monthly bills. Setup is one line: grab a key from [aistudio.google.com](https://aistudio.google.com).

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

Last 5 turns are sent verbatim; older turns are rolled into a running session summary.

### Long documents

Two mechanisms:

**Chunking (for chat).** Page-aware, ~800 tokens with 150-token overlap, split preferentially at headings, then paragraphs, then sentences. Every chunk records its page range, which is what makes citations possible. Chat never needs the whole document in context — only the six most relevant chunks.

**Map-reduce (for summaries).** Under ~150k tokens, one pass. Above that: group chunks into ~15k-token windows, summarize each into 2–3 dense sentences in parallel, then summarize the ordered section summaries. We chose this over stuffing everything into Sonnet's 1M context because cost scales far better and long-context recall degrades in the middle of very long inputs — map-reduce gives every section equal attention.

### Evaluation

Ten questions against a known test document — factual lookups, cross-section synthesis, deliberately-absent information, pronoun follow-ups, and one adversarial request to summarize a section that doesn't exist. Results and the failure analysis are in [`docs/AI_DESIGN.md`](docs/AI_DESIGN.md).

`<Replace with your actual result, e.g.: "9/10. The failure was a table split across a page break — the header ended up in a different chunk from the rows.">`

---

## Local setup

**Requirements:** Node 20+, pnpm, a Postgres database with the `vector` extension (Neon's free tier works), and API keys for Anthropic and Google AI Studio.

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
- `<Anything else you cut — say it plainly, it reads better than a gap.>`

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
