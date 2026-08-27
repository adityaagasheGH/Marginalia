"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CornerDownLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * The chat panel: ask questions about this PDF, get grounded answers.
 *
 * Streaming is hand-rolled rather than using @ai-sdk/react's useChat. The
 * server returns a plain text stream, so reading it is a ReadableStream loop
 * and about thirty lines — which avoids a second SDK dependency and keeps
 * every piece of the request visible in one file.
 *
 * Citations arrive in the X-Citations response header, not the body: the
 * server retrieves passages *before* generating a single token, so the page
 * numbers are already known when the response starts. That lets the body
 * stay a pure text stream.
 */

type Citation = { chunkId: string; pageStart: number; pageEnd: number };

type Message = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations?: Citation[];
};

/** "1-2" and "5-5" become "pp. 1-2" and "p. 5". */
function pageLabel(c: Citation): string {
  return c.pageStart === c.pageEnd
    ? `p. ${c.pageStart}`
    : `pp. ${c.pageStart}-${c.pageEnd}`;
}

/** Several retrieved chunks often share pages; show each range once. */
function uniquePages(citations: Citation[]): string[] {
  return [...new Set(citations.map(pageLabel))];
}

export function ChatPanel({
  documentId,
  disabled,
  disabledReason,
}: {
  documentId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Restore the saved conversation, so a page reload does not lose it.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${documentId}/chat`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data) => {
        if (!cancelled) {
          setMessages(data.messages ?? []);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Abort an in-flight stream if the user navigates away mid-answer.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Follow the newest token as it streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || pending) return;

    setInput("");
    setError(null);
    setPending(true);
    setStreaming("");

    // Show the question immediately. A temporary id is fine — this row is
    // replaced by the server's copy on the next load.
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "USER", content: question },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/documents/${documentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Something went wrong.");
      }
      if (!res.body) throw new Error("No response from the server.");

      const citations: Citation[] = JSON.parse(
        res.headers.get("X-Citations") ?? "[]",
      );

      // Read the stream chunk by chunk. `stream: true` tells the decoder a
      // multi-byte character may be split across chunk boundaries, so it
      // buffers the tail instead of emitting a broken character.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setStreaming(answer);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-a`,
          role: "ASSISTANT",
          content: answer,
          citations,
        },
      ]);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      // Put the question back so it is not lost to a failed request.
      setInput(question);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(null);
      setPending(false);
      abortRef.current = null;
    }
  }, [documentId, input, pending]);

  if (disabled) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-ink-muted">
          {disabledReason ?? "Chat isn't available for this document."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!loaded ? (
          <div className="flex justify-center pt-8">
            <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="space-y-2 pt-6 text-center">
            <p className="text-sm text-ink">Ask anything about this document.</p>
            <p className="text-xs text-ink-muted">
              Answers cite the page they came from, and say so when the
              document doesn&apos;t cover something.
            </p>
          </div>
        ) : null}

        {messages.map((m) =>
          m.role === "USER" ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-lg rounded-br-sm bg-accent-sub px-3 py-2 text-sm text-ink">
                {m.content}
              </p>
            </div>
          ) : (
            <div key={m.id} className="space-y-1.5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {m.content}
              </p>
              {m.citations && m.citations.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {uniquePages(m.citations).map((label) => (
                    <span
                      key={label}
                      className="rounded border border-rule px-1.5 py-0.5 text-[11px] text-ink-muted"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ),
        )}

        {/* The answer as it arrives. Becomes a real message once complete. */}
        {streaming !== null && (
          <div className="space-y-1.5">
            {streaming.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Searching the document…
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {streaming}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-rule bg-paper p-2.5 text-xs text-flag">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="border-t border-rule p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter adds a newline, as in most chat UIs.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask about this document…"
            rows={2}
            disabled={pending}
            className="max-h-32 min-h-[2.5rem] resize-none text-sm"
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => void send()}
            disabled={pending || input.trim().length === 0}
            aria-label="Send question"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
