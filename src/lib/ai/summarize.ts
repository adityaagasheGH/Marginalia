import { generateText } from "ai";
import { flash } from "@/lib/ai/client";
import { SUMMARY_SYSTEM, summaryUser } from "@/lib/ai/prompts";

// ~125k tokens. Single pass only; map-reduce for longer documents is not built.
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
    maxOutputTokens: 1024,
    temperature: 0.3,
    // Thinking model: keep internal reasoning brief on a bounded task.
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
  });

  return summary.trim();
}
