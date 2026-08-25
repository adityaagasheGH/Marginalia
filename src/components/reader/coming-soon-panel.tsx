import { Sparkles } from "lucide-react";

/**
 * Chat (RAG) and Comments are Day 2 work — this app is being built in the
 * documented order, not faked. Showing an honest "coming soon" state is
 * better than a chat box that silently does nothing.
 */
export function ComingSoonPanel({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Sparkles className="h-5 w-5 text-ink-muted" />
      <p className="text-sm text-ink-muted">{label} is coming next.</p>
    </div>
  );
}
