import { createGoogleGenerativeAI } from "@ai-sdk/google";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

/** Text generation: summaries, chat, query condensation. */
export const flash = google("gemini-flash-lite-latest");

/** Retrieval embeddings. Truncated to 768 dims (Matryoshka). */
export const embedding = google.textEmbeddingModel("gemini-embedding-001");

/** Must match `vector(768)` in schema.prisma and the HNSW index built on it. */
export const EMBEDDING_DIMS = 768;

export { google };
