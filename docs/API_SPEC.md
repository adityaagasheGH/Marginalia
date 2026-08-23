# API Specification

All routes are Next.js Route Handlers under `src/app/api/`. Every one of them:

1. Validates input with **Zod**
2. Resolves identity through **`lib/authorize.ts`** — never ad-hoc checks
3. Returns `{ error: string }` with a proper status on failure

**Auth model:** owners carry an Auth.js JWT session cookie. Guests carry a share token in the URL plus a signed httpOnly `guest_id` cookie. Both resolve through the same authorizer, which returns one of `{ role: 'owner' } | { role: 'guest', shareId, permission } | null`.

---

## Auth

### `POST /api/auth/signup`
```jsonc
// request
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "min 8 chars" }
// 201
{ "id": "clx...", "email": "ada@example.com" }
```
`409` if the email exists. bcrypt cost 12. Never echo the hash.

### `POST /api/auth/[...nextauth]`
Handled by Auth.js — credentials sign-in, sign-out, session.

### `POST /api/auth/forgot-password`
```jsonc
{ "email": "ada@example.com" }
// 200 — always, regardless of whether the account exists
{ "ok": true }
```
Generate 32 random bytes, email the raw token, store only its SHA-256 hash with a 1-hour expiry. **Always return 200** — a different response for unknown emails is an account-enumeration oracle.

### `POST /api/auth/reset-password`
```jsonc
{ "token": "...", "password": "new password" }
```
Hash the supplied token, look it up, check `expiresAt` and `usedAt`, update the password, mark used, invalidate existing sessions.

---

## Documents

### `GET /api/documents`
Auth: owner.

| Param | Meaning |
|---|---|
| `q` | search string |
| `mode` | `filename` (default) \| `semantic` |
| `cursor` | pagination cursor |

```jsonc
// 200
{
  "documents": [{
    "id": "clx...", "filename": "MSA_v3.pdf", "status": "READY",
    "summary": "A master services agreement between…",
    "pageCount": 24, "sizeBytes": 482910,
    "createdAt": "2026-08-20T09:14:00Z",
    "shareCount": 2, "commentCount": 7,
    "matchedExcerpt": "…"   // semantic mode only
  }],
  "nextCursor": null
}
```

`mode=semantic` embeds `q` (`RETRIEVAL_QUERY`), searches chunks scoped to the owner, groups by document, and fuses with a filename `ILIKE` match. See `DATA_MODEL.md`.

### `POST /api/documents`
Auth: owner. `multipart/form-data`, field `file`.

Validation, in order — all four, not just the first:

1. `file.type === 'application/pdf'`
2. Extension is `.pdf`
3. **First five bytes are `%PDF-`** — the only check a determined uploader can't trivially bypass
4. Size ≤ 25 MB

```jsonc
// 201 — returns immediately; processing continues in the background
{ "id": "clx...", "filename": "MSA_v3.pdf", "status": "PROCESSING" }
```

Errors: `400` invalid PDF · `413` too large · `429` rate limited.

Kick off ingest with `waitUntil(processDocument(id))` after the response. Set `export const maxDuration = 60`.

### `GET /api/documents/[id]`
Auth: owner **or** valid share token (`?token=`).

```jsonc
{
  "id": "clx...", "filename": "MSA_v3.pdf", "status": "READY",
  "summary": "…", "pageCount": 24,
  "createdAt": "…",
  "viewerRole": "guest", "canComment": true
}
```

Returns **`404`, not `403`**, when unauthorized. A 403 confirms the document exists, which is information the requester hasn't earned.

### `GET /api/documents/[id]/file`
Auth: owner or valid share token.

Streams the PDF bytes with `Content-Type: application/pdf` and `Content-Disposition: inline`. Fetches from Vercel Blob server-side; **the blob URL is never sent to the client.** This route existing at all is the reason "accessible only to the uploader and explicitly invited users" is actually true rather than aspirational.

### `DELETE /api/documents/[id]`
Auth: owner only. Deletes the blob, then the row (cascades to chunks, shares, comments, sessions).

---

## Sharing

### `POST /api/documents/[id]/shares`
Auth: owner only.
```jsonc
// request
{ "inviteeEmail": "bob@example.com", "permission": "COMMENT", "expiresInDays": 30 }
// 201
{
  "id": "clx...",
  "url": "https://marginalia.app/s/8Kj2mNp...",
  "token": "8Kj2mNp...",
  "permission": "COMMENT",
  "expiresAt": "2026-09-22T…"
}
```
Token: `crypto.randomBytes(32).toString('base64url')` — 256 bits, not guessable, not enumerable. If `inviteeEmail` is present, send the Resend invite.

### `GET /api/documents/[id]/shares` — owner only. List active shares.
### `DELETE /api/documents/[id]/shares/[shareId]` — owner only. Sets `revokedAt`; link dies immediately.

### `POST /api/shares/[token]/identify`
Auth: none.
```jsonc
{ "name": "Bob" }
```
Sets a signed httpOnly cookie `guest_{shareId}` containing `{ guestKey, name }`. Scoped to that share only — a guest identity on one document grants nothing on another.

---

## Comments

### `GET /api/documents/[id]/comments`
Auth: owner or valid share token. Optional `?since=<iso>` for polling.

```jsonc
{
  "comments": [{
    "id": "clx...", "body": "The indemnity cap here looks unusual.",
    "pageNumber": 12,
    "author": { "type": "guest", "name": "Bob" },
    "createdAt": "…",
    "replies": [{ "id": "clx...", "body": "Agreed — flag it.",
                  "author": { "type": "user", "name": "Ada" }, "createdAt": "…" }]
  }]
}
```

Never leak an author's email address to guests. Name only.

### `POST /api/documents/[id]/comments`
Auth: owner, or guest with `permission === 'COMMENT'`.
```jsonc
{ "body": "markdown subset", "parentId": null, "pageNumber": 12 }
```
Sanitize on render (`rehype-sanitize`), allowing only `strong`, `em`, `ul/ol/li`, `p`, `br`, `code`. `403` if a `VIEW`-only guest tries to post. Rate limit: 30/hour per identity.

### `DELETE /api/documents/[id]/comments/[commentId]`
Author, or the document owner (moderation). Soft delete.

---

## Chat

### `POST /api/documents/[id]/chat`
Auth: owner or valid share token. Rate limit: **10/min per identity** — this endpoint spends money, and it's reachable without an account.

```jsonc
// request — AI SDK useChat shape
{ "messages": [{ "role": "user", "content": "What's the notice period for termination?" }] }
```

Response: `text/event-stream` (AI SDK data stream protocol). Pipeline per `AI_DESIGN.md`: condense → embed → hybrid retrieve → assemble → stream → persist on finish.

Errors:
- `400` document not `READY`
- `429` rate limited
- `503` upstream LLM error — return a usable message, never a raw provider error (they sometimes echo request metadata)

### `GET /api/documents/[id]/chat`
Returns the caller's own session history. Owner and each guest see strictly their own conversation.

---

## Cross-cutting

**Rate limits** (Upstash, sliding window, keyed on user id or guest key + IP):

| Endpoint | Limit |
|---|---|
| `POST /api/auth/signup` | 5 / hour / IP |
| `POST /api/auth/forgot-password` | 3 / hour / IP |
| `POST /api/documents` | 20 / hour / user |
| `POST /api/documents/[id]/chat` | 10 / min / identity |
| `POST .../comments` | 30 / hour / identity |

**Error envelope**

```jsonc
{ "error": "Human-readable message", "code": "DOCUMENT_NOT_READY" }
```

Never surface stack traces, SQL, or provider error bodies to the client. Log the detail server-side, return the code.

**Status codes**: `400` validation · `401` not signed in · `403` signed in but not permitted · `404` not found *or* not authorized to know it exists · `409` conflict · `413` payload too large · `429` rate limited · `503` upstream failure.
