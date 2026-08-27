import { embed, embedMany } from "ai";
import { createId } from "@paralleldrive/cuid2";
import { db } from "@/lib/db";
import { embedding, EMBEDDING_DIMS } from "@/lib/ai/client";
import type { Chunk } from "@/lib/pdf/chunk";

/**
 * Embeddings: text in, a 768-number vector out.
 *
 * The vector encodes meaning, so two passages about the same idea land near
 * each other even with no words in common ("how do I cancel" ~ "termination
 * provisions"). That is the half of retrieval keyword search cannot do.
 *
 * The rule that governs this whole file: **document vectors and query vectors
 * must come from the same model at the same dimensionality.** Embeddings are
 * only comparable inside one model's vector space. Mixing models does not
 * raise an error — it silently returns nonsense — so the model and the width
 * are pinned in one place (lib/ai/client.ts) and asserted before every write.
 */

/**
 * Free-tier quotas are per-minute, and embedMany defaults maxParallelCalls to
 * Infinity — a 200-chunk document would fire every batch at once and get
 * rate-limited. Two in flight keeps ingest fast without tripping the limit.
 */
const MAX_PARALLEL_CALLS = 2;

/**
 * Gemini's embedding input limit is 2048 tokens. Chunks target 800, but the
 * runt-merging pass in chunk.ts can push one over, so clamp defensively:
 * a truncated embedding is a worse search result, a rejected one is a failed
 * upload. ~4 chars/token, with headroom.
 */
const MAX_EMBED_CHARS = 7000;

function assertDims(vectors: number[][]): void {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMS) {
      throw new Error(
        `Embedding width ${v.length} does not match the vector(${EMBEDDING_DIMS}) column. ` +
          `Storing it would corrupt the index.`,
      );
    }
  }
}

/**
 * Embed passages for storage.
 *
 * taskType RETRIEVAL_DOCUMENT tells Gemini these are haystack entries, not
 * questions. It positions them to be *found by* a question, which is a
 * different objective from matching another passage.
 */
export async function embedChunkTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { embeddings } = await embedMany({
    model: embedding,
    values: texts.map((t) => t.slice(0, MAX_EMBED_CHARS)),
    maxParallelCalls: MAX_PARALLEL_CALLS,
    providerOptions: {
      google: {
        outputDimensionality: EMBEDDING_DIMS,
        taskType: "RETRIEVAL_DOCUMENT",
      },
    },
  });

  assertDims(embeddings);
  return embeddings;
}

/**
 * Embed a user's question for searching.
 *
 * taskType RETRIEVAL_QUERY is the counterpart to RETRIEVAL_DOCUMENT above.
 * A question and the passage answering it are worded very differently; the
 * asymmetric task types are what close that gap. Using the same task type on
 * both sides measurably degrades results.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding: vector } = await embed({
    model: embedding,
    value: text.slice(0, MAX_EMBED_CHARS),
    providerOptions: {
      google: {
        outputDimensionality: EMBEDDING_DIMS,
        taskType: "RETRIEVAL_QUERY",
      },
    },
  });

  assertDims([vector]);
  return vector;
}

/** pgvector's text literal format: `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * Write chunks and their vectors.
 *
 * Raw SQL is required because Prisma cannot read or write `Unsupported`
 * columns, and `embedding` is one (Prisma has no native vector type).
 *
 * Note the quoted camelCase identifiers — "documentId", not document_id.
 * The init migration created the columns that way, and unquoted identifiers
 * in Postgres fold to lowercase, so `documentId` would resolve to a column
 * named `documentid` and fail. docs/DATA_MODEL.md shows snake_case here and
 * is wrong; this matches what the migration actually built.
 *
 * Deleting first makes re-indexing an existing document idempotent, and the
 * transaction means a mid-run failure cannot leave a document half-embedded —
 * which would silently return partial answers rather than erroring.
 */
export async function replaceChunks(
  documentId: string,
  chunks: Chunk[],
  embeddings: number[][],
): Promise<void> {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `chunk/embedding count mismatch: ${chunks.length} vs ${embeddings.length}`,
    );
  }
  assertDims(embeddings);

  await db.$transaction([
    db.$executeRaw`DELETE FROM document_chunks WHERE "documentId" = ${documentId}`,
    ...chunks.map((chunk, i) =>
      db.$executeRaw`
        INSERT INTO document_chunks
          ("id", "documentId", "chunkIndex", "content", "pageStart", "pageEnd", "tokenCount", "embedding")
        VALUES (
          ${createId()},
          ${documentId},
          ${i},
          ${chunk.content},
          ${chunk.pageStart},
          ${chunk.pageEnd},
          ${chunk.tokenCount},
          ${toVectorLiteral(embeddings[i])}::vector
        )
      `,
    ),
  ]);
}
