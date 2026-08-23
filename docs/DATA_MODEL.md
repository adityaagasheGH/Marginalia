# Data Model

Postgres (Neon) + Prisma + pgvector.

---

## Entity overview

```
User ──1:N──> Document ──1:N──> DocumentChunk  (embedding vector(768))
 │                │
 │                ├──1:N──> Share ──1:N──> Comment (guest)
 │                ├──1:N──> Comment ──self──> Comment (threading)
 │                └──1:N──> ChatSession ──1:N──> ChatMessage
 │
 └──1:N──> PasswordResetToken
```

Design notes worth defending in a review:

- **`Document.status` is an enum, not a boolean.** Ingest is async and can fail in several distinct ways; the UI needs to distinguish "still working" from "this PDF is a scan with no text" from "the LLM call failed."
- **`extractedText` is stored.** It costs a few hundred KB and saves you re-downloading and re-parsing the blob every time you want to re-summarize or re-chunk. Worth it during development alone.
- **Comments carry either a `userId` or a `guestName` + `shareId`, never both.** A DB check constraint enforces it.
- **Chat sessions are scoped to identity, not just to document.** A guest's conversation must not leak into the owner's, or into another guest's.

---

## `prisma/schema.prisma`

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

// ─────────────────────────────── Users ───────────────────────────────

model User {
  id           String   @id @default(cuid())
  name         String
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  documents    Document[]
  comments     Comment[]
  chatSessions ChatSession[]
  resetTokens  PasswordResetToken[]

  @@map("users")
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique          // sha256 of the emailed token — never store raw
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("password_reset_tokens")
}

// ───────────────────────────── Documents ─────────────────────────────

enum DocumentStatus {
  PROCESSING   // uploaded, pipeline running
  READY        // text extracted, chunks embedded, summary generated
  NO_TEXT      // valid PDF but no extractable text (scan/image-only)
  FAILED       // extraction or LLM error — errorMessage explains
}

model Document {
  id            String         @id @default(cuid())
  ownerId       String
  filename      String
  blobUrl       String                          // private; never sent to the client
  blobPathname  String
  sizeBytes     Int
  pageCount     Int?
  status        DocumentStatus @default(PROCESSING)
  summary       String?        @db.Text         // 3–5 sentences
  extractedText String?        @db.Text
  errorMessage  String?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  owner        User            @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  chunks       DocumentChunk[]
  shares       Share[]
  comments     Comment[]
  chatSessions ChatSession[]

  @@index([ownerId, createdAt(sort: Desc)])
  @@index([ownerId, filename])
  @@map("documents")
}

model DocumentChunk {
  id         String @id @default(cuid())
  documentId String
  chunkIndex Int
  content    String @db.Text
  pageStart  Int
  pageEnd    Int
  tokenCount Int

  // pgvector — Prisma has no native vector type, so it's Unsupported.
  // Reads/writes go through $queryRaw. See "Vector operations" below.
  embedding Unsupported("vector(768)")?

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([documentId, chunkIndex])
  @@index([documentId])
  @@map("document_chunks")
}

// ────────────────────────────── Sharing ──────────────────────────────

enum SharePermission {
  VIEW      // read PDF + summary + chat
  COMMENT   // the above, plus can post comments
}

model Share {
  id           String          @id @default(cuid())
  documentId   String
  token        String          @unique   // 32 random bytes, base64url
  createdById  String
  inviteeEmail String?
  permission   SharePermission @default(COMMENT)
  expiresAt    DateTime?
  revokedAt    DateTime?
  lastAccessAt DateTime?
  createdAt    DateTime        @default(now())

  document Document      @relation(fields: [documentId], references: [id], onDelete: Cascade)
  comments Comment[]
  sessions ChatSession[]

  @@index([documentId])
  @@map("shares")
}

// ───────────────────────────── Comments ──────────────────────────────

model Comment {
  id         String    @id @default(cuid())
  documentId String
  parentId   String?                 // one level of threading
  userId     String?                 // set for the authenticated owner
  shareId    String?                 // set for guests
  guestName  String?                 // set for guests
  body       String    @db.Text      // markdown subset: bold, italic, lists
  pageNumber Int?                    // optional anchor to a PDF page
  createdAt  DateTime  @default(now())
  deletedAt  DateTime?

  document Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  parent   Comment?  @relation("CommentThread", fields: [parentId], references: [id], onDelete: Cascade)
  replies  Comment[] @relation("CommentThread")
  user     User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  share    Share?    @relation(fields: [shareId], references: [id], onDelete: SetNull)

  @@index([documentId, createdAt])
  @@index([parentId])
  @@map("comments")
}

// ─────────────────────────────── Chat ────────────────────────────────

enum ChatRole {
  USER
  ASSISTANT
}

model ChatSession {
  id         String   @id @default(cuid())
  documentId String
  userId     String?              // owner's session
  shareId    String?              // guest's session
  guestKey   String?              // per-browser id from the signed guest cookie
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  document Document      @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user     User?         @relation(fields: [userId], references: [id], onDelete: Cascade)
  share    Share?        @relation(fields: [shareId], references: [id], onDelete: Cascade)
  messages ChatMessage[]

  @@unique([documentId, userId])
  @@unique([documentId, shareId, guestKey])
  @@index([documentId])
  @@map("chat_sessions")
}

model ChatMessage {
  id        String   @id @default(cuid())
  sessionId String
  role      ChatRole
  content   String   @db.Text
  citations Json?    // [{ chunkId, pageStart, pageEnd }]
  createdAt DateTime @default(now())

  session ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
  @@map("chat_messages")
}
```

---

## Migration additions

Prisma won't generate these. Create the migration, then hand-edit the SQL before applying.

```bash
npx prisma migrate dev --create-only --name init
# edit prisma/migrations/<ts>_init/migration.sql, then:
npx prisma migrate dev
```

Append to the generated SQL:

```sql
-- pgvector extension (Neon: available, just needs enabling)
CREATE EXTENSION IF NOT EXISTS vector;

-- Vector similarity index.
-- HNSW gives better recall/latency than IVFFlat and needs no training pass,
-- which matters here because we build the index before any rows exist.
CREATE INDEX document_chunks_embedding_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops);

-- Full-text index for the keyword half of hybrid retrieval.
-- Catches exact terms — clause numbers, party names, defined terms —
-- that dense embeddings routinely miss.
CREATE INDEX document_chunks_fts_idx
  ON document_chunks
  USING gin (to_tsvector('english', content));

-- Filename search on the dashboard
CREATE INDEX documents_filename_trgm_idx
  ON documents USING gin (filename gin_trgm_ops);
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- A comment belongs to exactly one identity: a user or a guest, never both.
ALTER TABLE comments ADD CONSTRAINT comment_single_author CHECK (
  (user_id IS NOT NULL AND share_id IS NULL AND guest_name IS NULL)
  OR
  (user_id IS NULL AND share_id IS NOT NULL AND guest_name IS NOT NULL)
);
```

> Order matters: `CREATE EXTENSION pg_trgm` must come before the trigram index. Move it above.

---

## Vector operations

Prisma can't read or write `Unsupported` columns through the normal client. Two raw helpers cover everything.

**Insert chunks with embeddings**

```ts
// lib/ai/embed.ts
export async function insertChunks(
  documentId: string,
  chunks: { content: string; pageStart: number; pageEnd: number; tokenCount: number }[],
  embeddings: number[][],
) {
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const vec = `[${embeddings[i].join(',')}]`;   // pgvector literal
    await db.$executeRaw`
      INSERT INTO document_chunks
        (id, document_id, chunk_index, content, page_start, page_end, token_count, embedding)
      VALUES
        (${createId()}, ${documentId}, ${i}, ${c.content},
         ${c.pageStart}, ${c.pageEnd}, ${c.tokenCount}, ${vec}::vector)
    `;
  }
}
```

**Hybrid retrieval**

```ts
// lib/ai/retrieve.ts
type Hit = {
  id: string; content: string;
  pageStart: number; pageEnd: number;
  score: number;
};

export async function hybridSearch(documentId: string, query: string, queryVec: number[]) {
  const vec = `[${queryVec.join(',')}]`;

  // Reciprocal Rank Fusion: combine two ranked lists without needing
  // the scores to be on comparable scales. k=60 is the standard constant.
  const rows = await db.$queryRaw<Hit[]>`
    WITH dense AS (
      SELECT id, content, page_start, page_end,
             ROW_NUMBER() OVER (ORDER BY embedding <=> ${vec}::vector) AS rank
      FROM document_chunks
      WHERE document_id = ${documentId}
      ORDER BY embedding <=> ${vec}::vector
      LIMIT 12
    ),
    sparse AS (
      SELECT id, content, page_start, page_end,
             ROW_NUMBER() OVER (
               ORDER BY ts_rank(to_tsvector('english', content),
                                plainto_tsquery('english', ${query})) DESC
             ) AS rank
      FROM document_chunks
      WHERE document_id = ${documentId}
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
      LIMIT 12
    )
    SELECT
      COALESCE(d.id, s.id)                 AS id,
      COALESCE(d.content, s.content)       AS content,
      COALESCE(d.page_start, s.page_start) AS "pageStart",
      COALESCE(d.page_end,   s.page_end)   AS "pageEnd",
      COALESCE(1.0 / (60 + d.rank), 0) + COALESCE(1.0 / (60 + s.rank), 0) AS score
    FROM dense d
    FULL OUTER JOIN sparse s ON d.id = s.id
    ORDER BY score DESC
    LIMIT 6
  `;
  return rows;
}
```

`<=>` is pgvector's cosine distance operator (`<->` is L2, `<#>` is negative inner product). Cosine is what you want with normalized embeddings.

**Dashboard semantic search** — same idea, but across all of a user's documents, grouped:

```sql
SELECT d.id, d.filename, d.summary, MIN(c.embedding <=> $1::vector) AS distance
FROM document_chunks c
JOIN documents d ON d.id = c.document_id
WHERE d.owner_id = $2
GROUP BY d.id
HAVING MIN(c.embedding <=> $1::vector) < 0.55   -- tune on real data
ORDER BY distance ASC
LIMIT 20
```

Union that with a filename `ILIKE '%q%'` match so literal filename searches still behave predictably. The threshold is the one number to tune by hand — too loose and every search returns everything.

---

## Seed script

`prisma/seed.ts` should create a demo account and pre-upload three documents with contrasting shapes, so your video has no dead air and reviewers can poke around immediately:

| Doc | Purpose |
|---|---|
| A short contract (~5 pages) | Fast happy path |
| A long report (~80 pages) | Proves map-reduce summarization works |
| A doc whose filename says nothing about its contents | Demonstrates semantic search convincingly |

Put the demo credentials in the README.
