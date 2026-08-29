"use client";

import { useRef, useState } from "react";
import { Bold, Italic, List, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Comment box with a markdown toolbar. Formatting is stored as plain text,
 * never HTML — rendering happens in lib/comment-format.tsx.
 */
export function CommentComposer({
  onSubmit,
  placeholder = "Add a comment…",
  autoFocus,
  submitLabel = "Comment",
  compact,
  onCancel,
}: {
  onSubmit: (body: string) => Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  compact?: boolean;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  /** Wrap the selection in markers, or insert an empty pair at the caret. */
  const wrap = (marker: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = value.slice(start, end);
    const next =
      value.slice(0, start) + marker + selected + marker + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + marker.length + selected.length;
      el.setSelectionRange(selected ? caret : start + marker.length, caret);
    });
  };

  /** Prefix each selected line with "- ", which is the list syntax. */
  const bulletize = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndRaw = value.indexOf("\n", end);
    const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;

    const block = value.slice(lineStart, lineEnd) || "";
    const bulleted = block
      .split("\n")
      .map((line) => (/^\s*[-*]\s/.test(line) ? line : `- ${line}`))
      .join("\n");

    setValue(value.slice(0, lineStart) + bulleted + value.slice(lineEnd));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + bulleted.length);
    });
  };

  const send = async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter sends; plain Enter newlines, for bullet lists.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        disabled={busy}
        className="resize-none text-sm"
      />

      <div className="flex items-center gap-1">
        <ToolbarButton label="Bold" onClick={() => wrap("**")}>
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => wrap("*")}>
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Bullet list" onClick={bulletize}>
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="ml-auto flex items-center gap-1.5">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void send()}
            disabled={busy || value.trim().length === 0}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded border border-rule px-2 py-1 text-ink-muted transition-colors hover:bg-accent-sub hover:text-ink"
    >
      {children}
    </button>
  );
}
