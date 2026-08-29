import { embed, embedMany } from "ai";
import { createId } from "@paralleldrive/cuid2";
import { db } from "@/lib/db";
import { embedding, EMBEDDING_DIMS } from "@/lib/ai/client";
import type { Chunk } from "@/lib/pdf/chunk";

// Free-tier quotas are per-minute and embedMany defaults to Infinity parallel.
const MAX_PARALLEL_CALLS = 2;

// Gemini's embedding input limit is 2048 tokens; ~4 chars/token with headroom.
const MAX_EMBED_CHARS = 7000;

function assertDims(vectors: number[][]): void {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMS) {
      throw new Error(
        `Embedding width ${v.length} does not match vector(${EMBEDDING_DIMS}).`,
      );
    }
  }
}

/** Embed passages for storage. */
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
 * Embed a question for searching. The asymmetric task type is deliberate —
 * a question and the passage answering it are worded very differently.
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

/** pgvector text literal: `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * Replace a document's chunks and vectors in one transaction.
 *
 * Raw SQL because Prisma cannot write `Unsupported` columns. Identifiers are
 * quoted camelCase to match the migration — unquoted names fold to lowercase.
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
