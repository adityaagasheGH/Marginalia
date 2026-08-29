import { db } from "@/lib/db";
import { embedQuery, toVectorLiteral } from "@/lib/ai/embed";

export type Hit = {
  id: string;
  content: string;
  pageStart: number;
  pageEnd: number;
  score: number;
};

// Over-fetch from both engines so fusion has something to work with.
const DENSE_K = 12;
const SPARSE_K = 12;
const TOP_K = 6;

// RRF smoothing constant from the original paper.
const RRF_K = 60;

/**
 * Hybrid retrieval: dense vectors match meaning, full-text search catches
 * literals like "Section 4.2" that embeddings routinely miss. Reciprocal Rank
 * Fusion merges the two lists by rank position, since a cosine distance and a
 * ts_rank are not on comparable scales.
 *
 * Pass the condensed standalone query, not a raw follow-up.
 */
export async function hybridSearch(
  documentId: string,
  query: string,
): Promise<Hit[]> {
  const vector = toVectorLiteral(await embedQuery(query));

  // Identifiers are quoted camelCase to match the migration.
  const rows = await db.$queryRaw<Hit[]>`
    WITH dense AS (
      SELECT "id", "content", "pageStart", "pageEnd",
             ROW_NUMBER() OVER (ORDER BY "embedding" <=> ${vector}::vector) AS rank
      FROM document_chunks
      WHERE "documentId" = ${documentId}
        AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${vector}::vector
      LIMIT ${DENSE_K}
    ),
    sparse AS (
      SELECT "id", "content", "pageStart", "pageEnd",
             ROW_NUMBER() OVER (
               ORDER BY ts_rank(
                 to_tsvector('english', "content"),
                 plainto_tsquery('english', ${query})
               ) DESC
             ) AS rank
      FROM document_chunks
      WHERE "documentId" = ${documentId}
        AND to_tsvector('english', "content") @@ plainto_tsquery('english', ${query})
      LIMIT ${SPARSE_K}
    )
    SELECT
      COALESCE(d."id", s."id")                 AS "id",
      COALESCE(d."content", s."content")       AS "content",
      COALESCE(d."pageStart", s."pageStart")   AS "pageStart",
      COALESCE(d."pageEnd", s."pageEnd")       AS "pageEnd",
      (
        COALESCE(1.0 / (${RRF_K} + d.rank), 0) +
        COALESCE(1.0 / (${RRF_K} + s.rank), 0)
      )::float8                                AS "score"
    FROM dense d
    FULL OUTER JOIN sparse s ON d."id" = s."id"
    ORDER BY "score" DESC
    LIMIT ${TOP_K}
  `;

  return rows;
}

/** Numbered excerpts with page ranges, so the model can cite "(p. 12)". */
export function formatContext(hits: Hit[]): string {
  return hits
    .map((h, i) => `[${i + 1}] (pages ${h.pageStart}-${h.pageEnd})\n${h.content}`)
    .join("\n\n---\n\n");
}
