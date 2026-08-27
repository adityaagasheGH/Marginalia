import { db } from "@/lib/db";
import { embedQuery, toVectorLiteral } from "@/lib/ai/embed";

/**
 * Hybrid retrieval: find the passages of one document most relevant to a
 * question, using two different search engines and fusing their results.
 *
 * Why two. Dense vector search matches *meaning* — it finds the termination
 * clause when you ask "how do I cancel", with no shared vocabulary. It is
 * correspondingly bad at literals: ask "what does Section 4.2 say" and it
 * returns passages that feel similar while missing the one that literally
 * says "4.2". Postgres full-text search is the mirror image — exact on terms,
 * blind to paraphrase. Running both covers each one's blind spot.
 *
 * Both indexes already exist (init migration): HNSW on `embedding` for the
 * dense side, GIN on to_tsvector(content) for the sparse side.
 */

export type Hit = {
  id: string;
  content: string;
  pageStart: number;
  pageEnd: number;
  score: number;
};

/**
 * Take 12 from each engine, keep 6 after fusion. Over-fetching is what gives
 * fusion something to work with: a chunk ranked 9th by vectors and 2nd by
 * keywords should win, and it can only do that if both lists run deep enough
 * to contain it.
 */
const DENSE_K = 12;
const SPARSE_K = 12;
const TOP_K = 6;

/**
 * RRF's smoothing constant. 60 is the value from the original paper and the
 * de facto standard. It flattens the gap between top ranks, so one engine
 * being wildly confident cannot single-handedly decide the result.
 */
const RRF_K = 60;

/**
 * Retrieve the top passages for a query.
 *
 * `query` is used verbatim for keyword search, and its embedding for vector
 * search — so pass the *condensed* standalone query, never a raw follow-up
 * like "what about renewal?", which retrieves nothing useful either way.
 */
export async function hybridSearch(
  documentId: string,
  query: string,
): Promise<Hit[]> {
  const vector = toVectorLiteral(await embedQuery(query));

  /**
   * Reciprocal Rank Fusion. Each engine contributes 1/(60 + rank) for every
   * chunk it returned; the scores are summed and the total decides the order.
   *
   * The essential property: only *rank position* is used, never the raw
   * scores. A cosine distance and a ts_rank are not on comparable scales —
   * adding them directly would be meaningless arithmetic. Ranks always are.
   * A chunk appearing in both lists collects from both and rises to the top.
   *
   * FULL OUTER JOIN keeps chunks found by only one engine (their missing
   * side COALESCEs to 0), which is the entire point of running two.
   *
   * Identifiers are quoted camelCase because that is what the init migration
   * created. Unquoted identifiers fold to lowercase in Postgres, so bare
   * documentId would look for a column named "documentid" and fail.
   */
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

/**
 * Format hits as the context block handed to the model.
 *
 * Two deliberate choices. The numbering gives the model a concrete handle for
 * each excerpt, and the explicit page range is what lets it write "(p. 12)" —
 * a citation the user can actually go and check. An answer that cannot be
 * verified is worth much less than one that can.
 */
export function formatContext(hits: Hit[]): string {
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] (pages ${h.pageStart}-${h.pageEnd})\n${h.content}`,
    )
    .join("\n\n---\n\n");
}
