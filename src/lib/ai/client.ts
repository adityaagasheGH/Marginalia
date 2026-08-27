import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Central config for every LLM call. One place to swap providers or models.
 *
 * The Vercel AI SDK's Google provider reads GOOGLE_GENERATIVE_AI_API_KEY from
 * the environment. We create the provider explicitly (rather than importing
 * the default `google`) so the key source is obvious and testable.
 *
 * Models (single free Gemini key, one quota pool):
 *   gemini-flash-lite-latest — summaries, map-reduce, query condensation, chat
 *   gemini-embedding-001     — retrieval embeddings (768 dims), added Day 2
 *
 * Model history, because the docs are out of date:
 *   docs/AI_DESIGN.md specifies gemini-2.5-flash (1,500 req/day free). Google
 *   retired 2.5-flash for new API keys, so this moved to gemini-3.6-flash —
 *   but 3.6-flash's free tier allows only 20 requests/day
 *   (GenerateRequestsPerDayPerProjectPerModel-FreeTier), which one afternoon
 *   of uploads exhausts. gemini-flash-lite-latest has a workable free quota
 *   and is fast (~1.6s) with summary quality that holds up.
 *
 * These are "thinking" models, so callers pass thinkingLevel: "low" to keep
 * latency down on bounded tasks (see summarize.ts).
 */
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

/** Text generation model: summaries, chat, and query condensation. */
export const flash = google("gemini-flash-lite-latest");

/**
 * Embedding model: turns text into a 768-number vector for similarity search.
 *
 * 768 is not a free parameter — `document_chunks.embedding` is declared
 * `vector(768)` and the HNSW index is built on that exact width. Changing the
 * dimension means a migration plus re-embedding every existing document, so
 * the number is pinned here and in EMBEDDING_DIMS, and asserted at write time.
 *
 * gemini-embedding-001 natively emits 3072 dims and supports Matryoshka
 * truncation — the vector is trained so that its first N values are
 * independently meaningful. Asking for 768 therefore costs very little
 * quality while keeping the index roughly a quarter of the size.
 */
export const embedding = google.textEmbeddingModel("gemini-embedding-001");

/** Must match `vector(768)` in prisma/schema.prisma. */
export const EMBEDDING_DIMS = 768;

export { google };
