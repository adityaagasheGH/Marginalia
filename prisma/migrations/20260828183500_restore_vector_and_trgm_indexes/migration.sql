-- Restore two indexes that `prisma migrate dev` dropped.
--
-- WHY THEY GET DROPPED: schema.prisma cannot express either one. An HNSW
-- index needs a vector operator class, and `embedding` is declared
-- Unsupported("vector(768)") because Prisma has no vector type; the trigram
-- index needs gin_trgm_ops. Prisma therefore does not know they should exist,
-- sees them in the database, treats them as drift, and generates DROP INDEX.
--
-- This will happen again on the next `prisma migrate dev`. After any future
-- migration, re-run this file's statements (they are idempotent) or check
-- with: SELECT indexname FROM pg_indexes WHERE tablename = 'document_chunks';

CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Dense half of hybrid retrieval. vector_cosine_ops matches the `<=>`
-- operator used in src/lib/ai/retrieve.ts.
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_idx"
  ON "document_chunks"
  USING hnsw ("embedding" vector_cosine_ops);

-- Fuzzy filename search on the dashboard.
CREATE INDEX IF NOT EXISTS "documents_filename_trgm_idx"
  ON "documents"
  USING gin ("filename" gin_trgm_ops);
