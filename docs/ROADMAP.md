# Roadmap — 4 Days

The organizing principle: **deploy on day 1, before there's anything to deploy.** Deployment bugs are the most common way take-homes fail, and they're least fixable at hour 90. Push to Vercel with a "hello world" and wire up Neon/Blob/env vars before you write a feature.

Second principle: **the pipeline is the project.** Get upload → extract → summarize working end-to-end on day 1, even ugly. Everything else is CRUD you already know how to write.

---

## Day 1 — Skeleton, auth, and a deployed pipeline

**Goal by end of day: a deployed URL where you can sign up, upload a PDF, and see a real AI summary appear.**

### Morning (4h)
- [ ] `create-next-app` — TypeScript, App Router, Tailwind. Init git.
- [ ] Commit `.gitignore` with `.env*` **first**, before creating any `.env`. Verify with `git status`.
- [ ] **Get a free Gemini API key** from [aistudio.google.com](https://aistudio.google.com) — no credit card required. One key, zero cost.
- [ ] Neon project → copy `DATABASE_URL`. Vercel Blob store → `BLOB_READ_WRITE_TOKEN`.
- [ ] `prisma init`, paste schema from `DATA_MODEL.md`, first migration.
- [ ] `CREATE EXTENSION IF NOT EXISTS vector;` — hand-edit the migration SQL (see `DATA_MODEL.md`).
- [ ] **Deploy to Vercel now.** Set env vars in the dashboard (at minimum: `GOOGLE_GENERATIVE_AI_API_KEY`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`). Confirm the live URL loads and `prisma migrate deploy` ran.
- [ ] shadcn/ui init, pick a base colour, add: button, input, card, dialog, textarea, avatar, skeleton, sonner.

### Afternoon (4h)
- [ ] Auth.js v5: Credentials provider, `bcryptjs` (cost 12), JWT strategy, Prisma adapter.
- [ ] `POST /api/auth/signup` — Zod validation, duplicate-email check, hash, insert.
- [ ] `/login` and `/signup` pages. Middleware protecting `/dashboard` and `/documents/*`.
- [ ] `lib/authorize.ts` — write the chokepoint now, even if it only handles the owner case.
- [ ] **Verify on prod**: sign up, log in, hit a protected route logged out and get bounced.

### Evening (3h) — the important part
- [ ] `POST /api/documents`: magic-byte validation (`%PDF-`), size cap, blob upload, DB insert, return 201.
- [ ] `lib/pdf/extract.ts` with `unpdf` → `{ pageNumber, text }[]`.
- [ ] `lib/ai/summarize.ts` — single-pass only for now. Real prompt from `AI_DESIGN.md`, not a placeholder.
- [ ] Wire `waitUntil(processDocument(id))` after upload response.
- [ ] Bare-bones dashboard: list documents, show status badge, show summary when READY.

**Checkpoint:** upload a 5-page PDF on the *deployed* site → summary appears within ~15s. If yes, you're on schedule and the risky part is behind you.

---

## Day 2 — Reader, chat, RAG

**Goal: the three-pane reader works, and chat answers questions accurately with page citations.**

### Morning (4h)
- [ ] `GET /api/documents/[id]/file` — authorize, fetch blob, stream bytes. Never expose the blob URL.
- [ ] `react-pdf` viewer: page nav, zoom, fit-to-width, loading skeleton. Worker config is the usual footgun — see `UI_SPEC.md`.
- [ ] Reader layout: summary bar on top, PDF centre, right panel with Comments/Chat tabs.
- [ ] `GET/POST /api/documents/[id]/comments`, flat first. Poll every 5s.

### Afternoon (5h) — the graded part
- [ ] `lib/pdf/chunk.ts` — page-aware, ~800 tokens, 150 overlap, paragraph-boundary splits.
- [ ] `lib/ai/embed.ts` — Gemini batch embed, 768 dims, `RETRIEVAL_DOCUMENT` task type, retry with backoff on 429.
- [ ] Add chunk + embed to the ingest pipeline. Re-upload a doc, confirm rows land in `document_chunks`.
- [ ] `lib/ai/retrieve.ts` — pgvector cosine query via `$queryRaw`, then add Postgres FTS, then RRF fusion.
- [ ] `POST /api/documents/[id]/chat` with `streamText`. Condense step → retrieve → grounded system prompt → stream.
- [ ] `ChatPanel` with `useChat`. Streaming tokens, auto-scroll, page-citation chips.
- [ ] Persist messages on `onFinish`.

### Evening (2h)
- [ ] **Test multi-turn hard.** Ask a question, then a pronoun follow-up ("what about *that* clause?"). If retrieval breaks, your condense prompt is wrong — fix it now, not on day 4.
- [ ] Ask something the PDF genuinely doesn't cover. It must say so. Tune the system prompt until it does, reliably.

**Checkpoint:** three consecutive follow-up questions resolve correctly, answers cite pages, and an off-topic question gets an honest "not in this document."

---

## Day 3 — Sharing, guests, long documents, semantic search

### Morning (3h)
- [ ] `POST /api/documents/[id]/shares` — 32-byte `base64url` token via `crypto.randomBytes`.
- [ ] `/s/[token]` public route: full reader for guests, no login.
- [ ] Guest identity: name prompt on first comment → signed httpOnly cookie scoped to that token.
- [ ] Guest comments and guest chat both work. Extend `authorize.ts` to handle the share path — **do not fork the logic.**
- [ ] Share dialog: copy link, optional email invite, revoke, list active shares.

### Afternoon (3h)
- [ ] **Map-reduce summarization** for long docs. Test on a genuinely long PDF (60+ pages — grab a public annual report or a court filing).
- [ ] Scanned-PDF guard: if extracted text is under ~200 chars, set status `NO_TEXT` and show a clear message instead of summarizing nothing.
- [ ] Semantic dashboard search: embed the query (`RETRIEVAL_QUERY`), search chunks, group by document, fuse with filename `ILIKE`. Debounce 300ms.
- [ ] Threaded comments: `parentId`, one level of nesting, reply UI.

### Evening (3h)
- [ ] Resend: share-invite email.
- [ ] Upstash rate limits on `/chat` (10/min per identity) and `/documents` POST (20/hour per user).
- [ ] Responsive pass: on mobile the three panes become tabs. Test on a real phone, not just devtools.
- [ ] Empty states, error states, toasts, loading skeletons.

**Checkpoint:** open the share link in a fresh incognito window. Read, comment, and chat as a guest. This is the flow most likely to be broken on prod while working locally.

---

## Day 4 — Polish, harden, document, record

### Morning (3h)
- [ ] Password reset flow (`docs/API_SPEC.md`) — **only if the rest is genuinely done.** Otherwise note it as a scope trade-off in the README and move on.
- [ ] Security sweep against `docs/SECURITY.md` checklist.
- [ ] `git log -p | grep -iE "sk-|api.?key|password"` — confirm nothing leaked in history. If it did, rotate the key and rewrite history.
- [ ] Try to access another user's document by ID while logged in as someone else. Expect 404 (not 403 — don't confirm existence).

### Afternoon (3h)
- [ ] **Write the README properly.** The "AI Approach" section is graded directly. Cover: which models and why, prompt structure, chunking parameters and the reasoning, long-doc strategy, and honest known limitations.
- [ ] `.env.example` with every variable, commented, no values.
- [ ] Seed a demo account with 3 pre-uploaded documents of varied length so the video has no dead air.
- [ ] Final deploy. Full run-through on the live URL in a clean browser profile.

### Evening (2h) — the video
Script it. 3–5 minutes, no rambling. Suggested beats:

| Time | Beat |
|---|---|
| 0:00–0:20 | What Marginalia is, one sentence. Show the dashboard. |
| 0:20–0:50 | Sign up → upload a PDF → summary appears. Say the words "map-reduce" when you mention long docs. |
| 0:50–1:40 | **Chat.** Ask a specific factual question → correct answer with page citation. Ask a pronoun follow-up → it resolves. Ask something absent → it declines honestly. *Call out that last one explicitly.* |
| 1:40–2:20 | Share link → incognito window → guest reads, comments, and chats without an account. |
| 2:20–2:50 | Semantic search: search a concept, not a filename, and surface a document whose title doesn't match. |
| 2:50–3:30 | 20 seconds of code: `authorize.ts`, then `prompts.ts`. Say "no keys client-side, all LLM calls server-side." |
| 3:30–4:00 | Known limitations, honestly. Close. |

---

## Risk register

| Risk | Mitigation |
|---|---|
| Vercel function timeout on a big PDF | `export const maxDuration = 60`. Batch embeddings. If a doc still times out, mark `FAILED` with a real message and offer retry — a graceful failure beats a hang. |
| Gemini free-tier 429s | Batch of 20, exponential backoff, 3 retries. Log and continue rather than failing the whole ingest. |
| `react-pdf` worker breaks in production | Copy the worker to `/public` and set `workerSrc` to a local path. CDN-loaded workers fail behind strict CSP. |
| Ingest silently fails, user sees a spinner forever | Explicit `FAILED` status + error message on the card + retry button. |
| Running out of time | Cut in this order: password reset → email → threaded comments → semantic search. **Never cut chat quality.** |
