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

/** Text generation model: summaries and (later) chat + condensation. */
export const flash = google("gemini-flash-lite-latest");

export { google };
