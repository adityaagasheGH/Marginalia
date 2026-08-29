import { generateText } from "ai";
import { flash } from "@/lib/ai/client";
import { CONDENSE_SYSTEM, condenseUser } from "@/lib/ai/prompts";

const HISTORY_TURNS = 6;
const MAX_QUERY_CHARS = 300;

export type Turn = { role: "USER" | "ASSISTANT"; content: string };

/**
 * Rewrite a follow-up into a standalone search query.
 *
 * "And what about renewal?" embeds to noise; resolved against the history it
 * retrieves the right passage. This fixes retrieval only — it is separate
 * from the history the answering model receives, and invisible to the user.
 */
export async function condenseQuery(
  message: string,
  history: Turn[],
): Promise<string> {
  if (history.length === 0) return message;

  const transcript = history
    .slice(-HISTORY_TURNS)
    .map((t) => {
      const who = t.role === "USER" ? "User" : "Assistant";
      // Answers are truncated: they only need to supply the missing subject.
      const text =
        t.role === "ASSISTANT" && t.content.length > 300
          ? `${t.content.slice(0, 300)}...`
          : t.content;
      return `${who}: ${text}`;
    })
    .join("\n");

  try {
    const { text } = await generateText({
      model: flash,
      system: CONDENSE_SYSTEM,
      prompt: condenseUser(transcript, message),
      maxOutputTokens: 256,
      temperature: 0,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    });

    const condensed = text.trim().replace(/^["']|["']$/g, "");

    // Fall back to the raw message rather than retrieving on nothing.
    if (condensed.length === 0 || condensed.length > MAX_QUERY_CHARS) {
      return message;
    }
    return condensed;
  } catch {
    return message;
  }
}
