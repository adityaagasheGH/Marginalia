import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Central config for every LLM call. One place to swap providers or models.
 *
 * The Vercel AI SDK's Google provider reads GOOGLE_GENERATIVE_AI_API_KEY from
 * the environment. We create the provider explicitly (rather than importing
 * the default `google`) so the key source is obvious and testable.
 *
 * Models (docs/AI_DESIGN.md § 0 — single free Gemini key, one quota pool):
 *   gemini-2.5-flash     — summaries, map-reduce, query condensation, chat
 *   gemini-embedding-001 — retrieval embeddings (768 dims), added Day 2
 */
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

/** Text generation model: summaries and (later) chat + condensation. */
export const flash = google("gemini-3.6-flash");

export { google };
