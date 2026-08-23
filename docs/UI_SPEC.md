# UI Specification

"UI and Design" is one of nine must-have features and appears in the evaluation criteria. It is also the first thing anyone sees. Budget real time for it — a working backend behind a default-Tailwind grey page reads as unfinished.

---

## Visual direction

The subject is documents: reading them, marking them up, arguing about them. The design should feel like a **reading environment**, not a SaaS dashboard. Two consequences:

- **The page is the hero.** Everything else is chrome around a piece of paper. Generous whitespace, restrained colour, no gradients competing with the document.
- **The margin is where the product lives.** Comments and chat sit in the margin, which is the entire metaphor of the name. Make that gutter feel deliberate.

### Tokens

```css
/* Warm-neutral paper against ink, with a single indigo accent.
   Deliberately not the cream-and-terracotta default — this reads as
   library, not artisanal-bakery-landing-page. */
--paper:      #FBFAF8;   /* app background  */
--surface:    #FFFFFF;   /* cards, panels   */
--ink:        #1A1917;   /* primary text    */
--ink-muted:  #6B6862;   /* secondary text  */
--rule:       #E5E2DC;   /* hairline borders */
--accent:     #3D4EDB;   /* actions, links, active states */
--accent-sub: #EEF0FE;   /* accent backgrounds */
--flag:       #C2410C;   /* errors, destructive */
--ok:         #15803D;   /* ready status */
```

**Type**
- Display / headings: `Instrument Serif` or `Fraunces` — a real serif, used sparingly. Signals "document" instantly.
- Body / UI: `Inter` — boring on purpose; it disappears, which is what you want next to rendered PDF text.
- Mono (page refs, tokens, code): `JetBrains Mono`

**Signature element:** the citation chip. When chat cites `(p. 12)`, render it as a small mono-set chip that, on click, scrolls the PDF viewer to page 12 and pulses the page border. It's one interaction, it's the thing nobody else will build, and it demos in three seconds. Spend your boldness there and keep everything else quiet.

**Radius** `6px` throughout — soft enough to feel modern, sharp enough to feel like paper. No shadows except a hairline on the floating chat composer.

---

## Screens

### Auth (`/login`, `/signup`)

Centred card, max-width 400px, on `--paper`. Logo, one-line value prop, form, cross-link. Inline field errors, not a toast. Disabled submit with a spinner while pending.

### Dashboard (`/dashboard`)

```
┌──────────────────────────────────────────────────────────┐
│  Marginalia                          [search]   [avatar] │
├──────────────────────────────────────────────────────────┤
│  Your documents                          [ Upload PDF ]  │
│                                                          │
│  ┌────────────────────┐ ┌────────────────────┐          │
│  │ ▤  MSA_v3.pdf      │ │ ▤  Q3_Report.pdf   │          │
│  │ 24 pages · Aug 20  │ │ 81 pages · Aug 19  │          │
│  │                    │ │                    │          │
│  │ A master services  │ │ ◔ Analyzing…       │          │
│  │ agreement between  │ │                    │          │
│  │ Acme and Bolt…     │ │                    │          │
│  │                    │ │                    │          │
│  │ 💬 7   🔗 2        │ │                    │          │
│  └────────────────────┘ └────────────────────┘          │
└──────────────────────────────────────────────────────────┘
```

- Grid: 3 columns desktop / 2 tablet / 1 mobile
- Card shows filename, page count, upload date, summary (clamped to 4 lines), comment count, share count
- **Search bar has a mode toggle**: `Filename` / `Meaning`. Making semantic search *visible* is what turns good-to-have #4 from a hidden feature into a demo beat. Debounce 300ms. In Meaning mode, show the matched excerpt under the card with the matching phrase highlighted.
- Upload: drag-and-drop zone plus a button. Optimistically insert a `PROCESSING` card the instant the response returns, then poll.
- **Status is explicit**: `◔ Analyzing…` with a shimmer, `⚠ No extractable text — this PDF appears to be a scan`, `⚠ Processing failed [Retry]`. Never an eternal spinner with no explanation.
- Empty state: an illustration, one sentence, and the upload control. *"Nothing here yet. Drop in a PDF and we'll read it for you."*

### Reader (`/documents/[id]` and `/s/[token]`)

Both routes render the same component. Only `viewerRole` differs — the guest view hides Share and Delete and shows a small "Shared with you by Ada" line. Building them as one component is worth saying out loud in the video: it's why guest access can't drift out of sync with owner access.

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Back    MSA_v3.pdf                        [Share]  [avatar]    │
├──────────────────────────────────────────────────────────────────┤
│ ✦ A master services agreement between Acme Corp and Bolt Ltd,    │
│   effective 1 Jan 2026, covering software development…    [more] │
├────────────────────────────────────┬─────────────────────────────┤
│                                    │  ┌────────┬────────┐        │
│         ┌──────────────┐           │  │Comments│  Chat  │        │
│         │              │           │  └────────┴────────┘        │
│         │   PDF page   │           │                             │
│         │              │           │  ┌───────────────────────┐  │
│         │              │           │  │ Bob · p.12            │  │
│         └──────────────┘           │  │ The indemnity cap     │  │
│                                    │  │ here looks unusual.   │  │
│    ‹  12 / 24  ›    −  100%  +     │  │   ↳ Ada: Agreed.      │  │
│                                    │  └───────────────────────┘  │
│                                    │  [ Write a comment…      ]  │
└────────────────────────────────────┴─────────────────────────────┘
```

**Summary bar** — pinned under the header, `--accent-sub` background, two lines clamped with a `more` toggle. It's the first thing on the page because the assignment asks for it there, and because it's genuinely the right place for it.

**PDF pane** — `react-pdf`. Page nav, zoom (50–200%), fit-to-width, keyboard `←`/`→`, and page-jump on citation click. Skeleton while the first page renders.

> **Worker gotcha:** copy `pdf.worker.min.mjs` into `/public` and set `pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`. CDN-loaded workers fail under strict CSP and are the classic "works locally, breaks on Vercel" bug.

**Comments tab** — chronological, one level of nesting. Guests are asked for a display name once, on first comment, in a small inline prompt (not a modal). Optimistic insert, poll every 5s for others'. Markdown toolbar: bold, italic, bullet list. Optional "attach to page 12" chip pulled from the current page.

**Chat tab** — messages, streaming, auto-scroll-to-bottom unless the user has scrolled up. Assistant messages render citation chips inline. Composer pinned to the bottom with a hairline shadow. Empty state seeds three suggested questions generated from the summary — it removes the blank-page problem and makes the demo flow better.

Stream a visible "Searching the document…" state during condense + retrieve, before the first token arrives. That gap is 1–2 seconds and feels broken if unexplained.

---

## Responsive

| Breakpoint | Behaviour |
|---|---|
| ≥1280px | Three columns: PDF centred, side panel 400px fixed |
| 1024–1280px | Side panel narrows to 340px |
| 768–1024px | Side panel collapses to a slide-over, toggled by a floating button |
| <768px | Full-screen tabs: `Document` / `Comments` / `Chat` in a bottom bar. PDF fits to width. Chat composer sits above the tab bar and respects the keyboard inset. |

Test on a real phone. Mobile Safari does things to `100vh` and to PDF canvases that devtools will not show you.

---

## States — build all of them

For every async surface: **loading · empty · error · success**. The ones most often skipped, and most often noticed:

- Upload rejected (not a PDF): inline red text on the dropzone naming the actual problem, not a generic toast
- Document `FAILED`: the real reason plus a Retry button
- Document `NO_TEXT`: *"This PDF appears to be scanned images. Text extraction found nothing, so summary and chat aren't available."* — honest, specific, and a differentiator
- Chat rate-limited: *"Slow down a moment — try again in 30 seconds."*
- Share link revoked or expired: a dedicated page, not a raw 404
- Offline / network error on send: keep the composed message, don't discard it

Errors explain what happened and what to do. They don't apologize, and they're never vague.

---

## Accessibility floor

Visible focus rings (`--accent`, 2px). Full keyboard navigation. Labelled form fields. `aria-live="polite"` on the streaming chat region. Contrast ≥ 4.5:1 — check `--ink-muted` on `--paper`. `prefers-reduced-motion` disables the shimmer and the citation pulse.
