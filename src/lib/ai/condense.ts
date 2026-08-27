import { generateText } from "ai";
import { flash } from "@/lib/ai/client";
import { CONDENSE_SYSTEM, condenseUser } from "@/lib/ai/prompts";

/**
 * Rewrite a follow-up question into a standalone search query.
 *
 * Retrieval embeds the user's message to find relevant passages. That works
 * on turn one and breaks on turn three, because a real follow-up carries its
 * meaning in the conversation, not in its own words:
 *
 *   turn 1  "What's the notice period for termination?"   -> embeds well
 *   turn 3  "And what about renewal?"                     -> embeds to noise
 *
 * Condensing against the recent history restores the missing subject before
 * anything is embedded. Note this is separate from the history the answering
 * model receives: condensation exists to fix *retrieval*, and it is invisible
 * to the user.
 */

/** Turns of history to consider. Enough to resolve a reference, cheap to send. */
const HISTORY_TURNS = 6;

/** A condensed query is one line. Anything longer means the model explained. */
const MAX_QUERY_CHARS = 300;

export type Turn = { role: "USER" | "ASSISTANT"; content: string };

/**
 * The first message of a conversation has nothing to resolve against, so it
 * is returned untouched — skipping a network round trip on every new chat.
 */
export async function condenseQuery(
  message: string,
  history: Turn[],
): Promise<string> {
  if (history.length === 0) return message;

  // Assistant answers are truncated: they exist here only to supply the
  // subject a pronoun refers to, and sending them whole would cost far more
  // tokens than that job requires.
  const transcript = history
    .slice(-HISTORY_TURNS)
    .map((t) => {
      const who = t.role === "USER" ? "User" : "Assistant";
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
      // A rewritten query is a handful of words; the budget is for the
      // model's internal reasoning, not the output.
      maxOutputTokens: 256,
      temperature: 0, // deterministic: this is a transformation, not writing
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    });

    const condensed = text.trim().replace(/^["']|["']$/g, "");

    // If condensation returns nothing usable, fall back to the raw message.
    // A degraded query still retrieves something; an empty one retrieves
    // nothing and the whole turn is wasted.
    if (condensed.length === 0 || condensed.length > MAX_QUERY_CHARS) {
      return message;
    }
    return condensed;
  } catch {
    // Never fail a chat turn because the optimisation step failed.
    return message;
  }
}
