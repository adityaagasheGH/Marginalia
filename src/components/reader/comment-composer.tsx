"use client";

import { useRef, useState } from "react";
import { Bold, Italic, List, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * The comment box: a textarea plus three formatting buttons.
 *
 * Formatting is stored as markdown text, not rich HTML. The toolbar only
 * wraps the selection in markers — so what the user types is exactly what is
 * stored, and rendering happens separately through lib/comment-format.tsx.
 * That keeps a comment a plain string end to end, which is why no untrusted
 * HTML ever exists to sanitize.
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

  /**
   * Wrap the current selection in a marker pair, or insert an empty pair and
   * place the caret between them when nothing is selected. Reading
   * selectionStart/End is what makes the buttons behave like a real editor
   * rather than appending characters at the end.
   */
  const wrap = (marker: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = value.slice(start, end);
    const next =
      value.slice(0, start) + marker + selected + marker + value.slice(end);
    setValue(next);
    // Restore focus and put the caret inside the markers.
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
    // Expand the selection to whole lines so a partial selection still
    // bullets the line it sits on.
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
          // Ctrl/Cmd+Enter sends. Plain Enter inserts a newline, because
          // comments are often multi-line and bullet lists need it.
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
      // type="button" matters: inside a form, a bare <button> defaults to
      // type="submit" and would post the page instead of formatting text.
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded border border-rule px-2 py-1 text-ink-muted transition-colors hover:bg-accent-sub hover:text-ink"
    >
      {children}
    </button>
  );
}
