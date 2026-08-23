# Marginalia — Project Blueprint

> **Marginalia** *(n.)* — notes written in the margins of a book.
> A PDF Intelligence & Collaboration System. Upload a document, get an AI summary, ask it questions, share it with anyone, and argue about it in the margins.

**Repo:** `marginalia`
**Tagline:** *Read it. Ask it. Argue about it.*
**Built for:** SpotDraft AI Intern take-home
**Timeline:** 4 days

---

## 0. Name options

| Name | Why it works | Domain-ish |
|---|---|---|
| **Marginalia** ⭐ | Literally means notes in the margins — nails commenting + reading. Slightly literary, feels like a real product. Fits SpotDraft's contracts/legal-doc world. | `marginalia.app` |
| **Verso** | The left-hand page of an open book. Short, clean, four letters of brand. | `verso.dev` |
| **Palimpsest** | A manuscript written over an older one — layers of meaning. Beautiful but a mouthful. | — |
| **Inkwell** | Warm, approachable, easy to draw a logo for. | `inkwell.io` |
| **Recto** | Verso's twin (right-hand page). Terse and sharp. | — |

Going with **Marginalia** throughout these docs. Swap the string in one place (`lib/constants.ts`) if you prefer another.

---

## 1. What we're actually building

Nine must-have features, five good-to-haves. Grouped by what they really are:

| Assignment feature | What it actually is |
|---|---|
| 1. Signup & auth | Credentials auth, bcrypt hashing, JWT session |
| 2. File upload | Multipart upload → blob store, magic-byte PDF validation |
| 3. Dashboard | Owner-scoped list + search |
| 4. Sharing | Unguessable share token → public read route |
| 5. Guest access + comments | Token-scoped session, no account required |
| 6. AI summary | Extract → (map-reduce if long) → 3–5 sentence summary |
| 7. AI chat | RAG: chunk → embed → retrieve → grounded answer, streaming |
| 8. Security | Authorization layer + secrets hygiene |
| 9. UI | Three-pane reader (PDF / comments / chat), responsive |

Features 6 and 7 are where the evaluation weight sits. **The AI must not feel like a wrapper.** See `docs/AI_DESIGN.md` — that's the document that wins this assignment.

---

## 2. The stack (and why)

### Recommended: single Next.js app on Vercel (completely free)

| Layer | Choice | Why this and not the alternative |
|---|---|---|
| **Framework** | Next.js 15 (App Router) + TypeScript | One repo, one deploy, one URL. Server Components + Route Handlers mean **API keys never touch the client** by construction — a graded requirement you get for free architecturally. A split React+FastAPI setup means two deploys, CORS, and a second thing that can break at 2am on day 4. |
| **Styling** | Tailwind CSS v4 + shadcn/ui | Fast, and the "UI and Design" criterion is a real 1/5th of the grade. shadcn gives you real components you own, not a dependency. |
| **Database** | Neon Postgres (serverless, free tier) + **pgvector** | One database for relational data *and* vector search. No separate Pinecone/Qdrant account to manage or explain. Semantic search (good-to-have #4) becomes a 20-line SQL query instead of a new service. |
| **ORM** | Prisma | Migrations, type safety, and readable schema — reviewers will read `schema.prisma` first. Vectors go through `$queryRaw`. |
| **Auth** | Auth.js v5 (NextAuth) Credentials provider + `bcryptjs` | The spec explicitly says *"passwords must be securely hashed."* Using a managed auth provider hides the one thing they asked you to demonstrate. Credentials + bcrypt (cost 12) shows you know how, and Auth.js handles session/JWT/CSRF so you don't hand-roll the dangerous parts. |
| **File storage** | Vercel Blob (private access) | Zero-config on Vercel, private by default, and PDFs stream back through an authorized route handler — never a public URL. Alternative: Supabase Storage or S3+presigned URLs, both fine. |
| **PDF text extraction** | `unpdf` | pdf.js core, built for serverless — no native binaries, no `pdf-parse` test-file bug, works on Vercel's runtime. Returns per-page text, which we need for page citations. |
| **PDF rendering** | `react-pdf` (`pdfjs-dist`) | Real viewer: page nav, zoom, text layer, search. `<iframe>` is faster to build but looks lazy and breaks on mobile Safari. |
| **LLM — summaries** | Google **`gemini-2.5-flash`** | Summarization is a bounded task. Flash is fast and **genuinely free** (1,500 req/day). No trial expiry, no credits burning. |
| **LLM — chat** | Google **`gemini-2.5-flash`** | Chat, query condensation, everything — same model, same free quota. Flash is instruction-following, handles streaming well, and one key is simpler than juggling multiple providers. |
| **LLM plumbing** | Vercel AI SDK (`ai`, `@ai-sdk/google`) | `streamText` + `useChat` gives token streaming (good-to-have #5) in about 15 lines. Drop-in provider swap. |
| **Embeddings** | Google **`gemini-embedding-001`** @ 768 dims | Same free tier, same quota pool as the LLM calls. 768 dims keeps the pgvector index compact. No separate embeddings budget. |
| **Email** | Resend (optional) | 3,000 free emails/month, 5-line integration, React Email templates. Covers good-to-have #2 and password reset. Shareable link is shown in UI if Resend isn't configured. |
| **Validation** | Zod | Every route handler validates its input. Cheap credibility. |
| **Rate limiting** | Native Node.js (Lru + Map) | Simple sliding-window rate limiter in-memory. For a four-day sprint on Vercel's free tier with a small demo audience, you won't need Redis. Falls back gracefully if you do need it later. |
| **Deployment** | Vercel | Native Next.js target, free tier, automatic HTTPS, env vars in dashboard. Neon is free. Nothing else charges. |

### Model IDs (free tier, verified as of Aug 2026)

```
gemini-2.5-flash         128K ctx    free tier (1,500 req/day, 10M tok/min)   ← chat + summaries
gemini-embedding-001     768 dims    free tier (shared quota)                 ← retrieval + search
```

**Total cost to build and demo: $0.** The free tier quota is more than enough for development, testing, recording the demo video, and the evaluation review.

### If you'd rather write Python

FastAPI + SQLAlchemy + `pypdf` + React/Vite, deployed as Railway (API) + Vercel (web). Everything in `docs/DATA_MODEL.md` and `docs/AI_DESIGN.md` ports directly — only the transport layer changes. **Pick whichever you can ship in four days.** The assignment says exactly this.

---

## 3. System architecture

```
                    ┌─────────────────────────────────────────┐
                    │            Browser (Next.js)            │
                    │  Dashboard · Reader · Comments · Chat   │
                    └────────────────┬────────────────────────┘
                                     │  fetch / SSE stream
                    ┌────────────────▼────────────────────────┐
                    │      Next.js Route Handlers (server)     │
                    │  ── all secrets live here, never client ─│
                    │                                          │
                    │  auth · upload · share · comments · chat │
                    └──┬──────────┬──────────┬─────────────┬───┘
                       │          │          │             │
              ┌────────▼──┐  ┌────▼─────┐ ┌──▼──────┐ ┌────▼─────┐
              │  Neon PG  │  │  Vercel  │ │ Claude  │ │  Gemini  │
              │ +pgvector │  │   Blob   │ │   API   │ │ Embed API│
              │           │  │  (PDFs)  │ │         │ │          │
              │ users     │  └──────────┘ └─────────┘ └──────────┘
              │ documents │
              │ chunks[v] │       ┌──────────┐
              │ shares    │       │  Resend  │  share + reset emails
              │ comments  │       └──────────┘
              │ messages  │
              └───────────┘
```

**Key invariant:** the browser never holds an API key, never talks to Anthropic/Gemini directly, and never receives a raw blob URL. Every byte of PDF is streamed through `/api/documents/[id]/file`, which runs the authorization check first.

---

## 4. The two pipelines

### Ingest (runs once, on upload)

```
POST /api/documents
  ├─ validate: MIME + magic bytes (%PDF-) + size ≤ 25MB
  ├─ upload to Vercel Blob (private)
  ├─ INSERT document (status = PROCESSING)
  ├─ return 201 immediately  ← user is not blocked
  └─ waitUntil(processDocument(id))
        ├─ extract text per page        (unpdf)
        ├─ chunk ~800 tok / 150 overlap (page-aware)
        ├─ embed chunks in batches      (Gemini)
        ├─ generate summary             (Claude Haiku, map-reduce if long)
        └─ UPDATE status = READY
```

Dashboard polls `/api/documents?since=` every 3s while any card is `PROCESSING`. Simple, works everywhere, no websocket infra.

### Query (runs per chat message)

```
POST /api/documents/[id]/chat
  ├─ authorize (owner OR valid share token)
  ├─ rate limit
  ├─ load last 5 turns
  ├─ CONDENSE  ─ Haiku rewrites the follow-up into a standalone query
  │             ("what about termination?" → "termination clause notice period")
  ├─ RETRIEVE  ─ hybrid: pgvector cosine (top 12) + Postgres FTS (top 12)
  │             → Reciprocal Rank Fusion → top 6 chunks
  ├─ ASSEMBLE  ─ numbered context blocks with page ranges
  ├─ GENERATE  ─ Sonnet 5, streamed, grounding-enforced system prompt
  └─ PERSIST   ─ save user + assistant message on stream finish
```

The **condense step** is the single highest-leverage thing in this project. Without it, "what about termination?" embeds into meaningless noise and retrieval fails — which is exactly the failure mode "maintain 3–5 turns of context" is testing for. Details in `docs/AI_DESIGN.md`.

---

## 5. Repo layout

```
marginalia/
├── README.md                    ← the graded one. write it last, write it well.
├── .env.example                 ← every key, no values
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       └── .../migration.sql    ← includes CREATE EXTENSION vector
├── src/
│   ├── app/
│   │   ├── (auth)/login|signup|forgot-password|reset-password/
│   │   ├── (app)/dashboard/
│   │   ├── (app)/documents/[id]/       ← owner reader
│   │   ├── s/[token]/                  ← guest reader (public)
│   │   └── api/
│   │       ├── auth/[...nextauth]/
│   │       ├── auth/signup | forgot-password | reset-password/
│   │       ├── documents/                     GET list+search, POST upload
│   │       └── documents/[id]/
│   │           ├── route.ts                   GET meta, DELETE
│   │           ├── file/route.ts              GET streamed PDF bytes
│   │           ├── comments/route.ts          GET, POST
│   │           ├── chat/route.ts              POST (SSE stream)
│   │           └── shares/route.ts            GET, POST, DELETE
│   ├── components/
│   │   ├── reader/     PdfViewer · CommentPanel · ChatPanel · SummaryBar
│   │   ├── dashboard/  DocumentCard · SearchBar · UploadDropzone
│   │   └── ui/         shadcn primitives
│   ├── lib/
│   │   ├── auth.ts            Auth.js config
│   │   ├── authorize.ts       ★ the single access-control chokepoint
│   │   ├── db.ts              Prisma singleton
│   │   ├── blob.ts
│   │   ├── ratelimit.ts
│   │   ├── pdf/extract.ts     unpdf → per-page text
│   │   ├── pdf/chunk.ts       page-aware token chunker
│   │   └── ai/
│   │       ├── client.ts      provider config
│   │       ├── prompts.ts     ★ every prompt, versioned, in one file
│   │       ├── summarize.ts   map-reduce
│   │       ├── retrieve.ts    hybrid search + RRF
│   │       └── embed.ts       Gemini batching + retry
│   └── types/
└── docs/                        ← these files
```

Two things reviewers will grep for: **`lib/authorize.ts`** (is access control centralized, or copy-pasted into 8 routes?) and **`lib/ai/prompts.ts`** (are prompts engineered, or f-string soup inline?). Make both of those files good.

---

## 6. Cost: $0

Every external service in this stack has a free tier that actually matters:

- **Neon Postgres:** 3 projects, 10GB storage, free forever
- **Vercel:** free tier deployment, $5/month for usage-based features (not needed)
- **Vercel Blob:** free tier storage
- **Google Gemini:** 1,500 req/day, 10M tokens/min, no credit card required, no expiry
- **Resend (optional):** 3,000 emails/month free
- **In-memory rate limiting:** no external service needed

You can build, test, record a demo video, and hand it over — all without a credit card or a dollar spent. This is intentional. A take-home that requires you to pay for infrastructure before they even look at it is a bad take-home.

---

## 7. Scope decisions, made now

**Building:**
- All 9 must-haves
- Good-to-have #5 (streaming) — free with the AI SDK, huge perceived-quality win
- Good-to-have #4 (semantic search) — we're already embedding chunks; it's one extra query
- Good-to-have #3 (threaded comments) — one `parentId` column
- Good-to-have #2 (share email) — Resend, ~30 minutes

**Building if day 4 has slack:**
- Good-to-have #1 (password reset) — full token flow, ~2 hours. Schema is already in place either way.

**Explicitly NOT building** (say so in the README — they said they appreciate transparency):
- Real-time comment sync (poll every 5s instead of websockets)
- OCR for scanned PDFs — we **detect** them and show "This PDF has no extractable text" rather than silently producing a hallucinated summary. *Detecting the failure is worth more than pretending it can't happen.*
- Per-user LLM usage quotas beyond basic rate limiting

---

## 8. What gets you graded well

| Criterion | The thing that actually moves the needle |
|---|---|
| Core engineering | Sharing and commenting genuinely work for a logged-out user in an incognito window. Test that specific flow before recording. |
| **AI implementation** | Multi-turn follow-ups that resolve pronouns correctly. Answers that cite page numbers. And a clean, honest "the document doesn't say" when you ask something it doesn't cover — **demo this in the video.** Refusing to hallucinate is a feature. |
| Code quality | `authorize.ts` and `prompts.ts`. Zod on every route. No `any`. No keys in git — check `git log -p` before pushing. |
| Deployment | Cold-start a fresh incognito session against the live URL and run every flow. Deployed-only bugs (env vars, function timeouts, blob permissions) are the classic way to lose points here. |
| Communication | README covers setup end-to-end *and* has a real "AI Approach" section. Video is 3–5 min, scripted, no dead air waiting for uploads — pre-upload a doc and have it ready. |

---

## 9. Doc index

| File | Contents |
|---|---|
| `docs/ROADMAP.md` | Hour-by-hour 4-day plan with checkpoints |
| `docs/DATA_MODEL.md` | Full Prisma schema + pgvector migration |
| `docs/API_SPEC.md` | Every endpoint: auth, payload, response, errors |
| `docs/AI_DESIGN.md` | Prompts, chunking, RAG, long-doc strategy, Gemini models |
| `docs/SECURITY.md` | Access matrix, threat notes, secrets handling |
| `docs/UI_SPEC.md` | Layout, responsive behaviour, states, visual direction |
| `README.md` | The submitted README — fill in the `<>` placeholders |
| `.env.example` | Every variable, documented, no values |
