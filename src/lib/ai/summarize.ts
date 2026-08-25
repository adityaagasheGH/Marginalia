import { generateText } from "ai";
import { flash } from "@/lib/ai/client";
import { SUMMARY_SYSTEM, summaryUser } from "@/lib/ai/prompts";

/**
 * Generate a 3-5 sentence summary of a document in a single pass.
 *
 * Day 1: single pass only. gemini-2.5-flash has a very large context window,
 * so a whole short/medium document fits comfortably. Long-document
 * map-reduce (docs/AI_DESIGN.md § 2) arrives on Day 3; to keep a single
 * pass bounded until then, we cap the input length and note the truncation.
 */

// ~500k chars ≈ 125k tokens: well within Flash's window, and a sane ceiling
// so one pathological upload cannot blow up a single request. Day 3 replaces
// this with real map-reduce over the full text.
const MAX_SUMMARY_CHARS = 500_000;

export async function summarizeDocument(
  filename: string,
  text: string,
): Promise<string> {
  const input =
    text.length > MAX_SUMMARY_CHARS ? text.slice(0, MAX_SUMMARY_CHARS) : text;

  const { text: summary } = await generateText({
    model: flash,
    system: SUMMARY_SYSTEM,
    prompt: summaryUser(filename, input),
    // gemini-3.6-flash is a "thinking" model: it spends output tokens on
    // internal reasoning before writing. thinkingLevel "low" keeps that
    // brief (~4s) since a 3-5 sentence summary needs little deliberation,
    // and the cap leaves room for the reasoning plus the visible summary.
    maxOutputTokens: 1024,
    temperature: 0.3, // low: we want faithful, not creative
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
  });

  return summary.trim();
}
