"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CommentComposer } from "@/components/reader/comment-composer";
import { renderCommentBody } from "@/lib/comment-format";

/**
 * Comments tab. Identical for the owner and for guests on a share link —
 * only the credential differs, which is why every fetch goes through api().
 * Threading is one level, matching the schema.
 */

type Comment = {
  id: string;
  parentId: string | null;
  body: string;
  pageNumber: number | null;
  createdAt: string;
  authorName: string;
  isOwner: boolean;
  mine: boolean;
};

type ViewerInfo = {
  role: "owner" | "guest";
  canComment: boolean;
  name: string | null;
};

/** Others' comments only arrive if we poll. */
const POLL_MS = 5000;

export function CommentsPanel({
  documentId,
  shareToken,
}: {
  documentId: string;
  shareToken?: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [viewer, setViewer] = useState<ViewerInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  const pendingRef = useRef(false);

  /** The authorizer reads the share token from the query string. */
  const api = useCallback(
    (path: string) =>
      shareToken
        ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(shareToken)}`
        : path,
    [shareToken],
  );

  const load = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    try {
      const res = await fetch(api(`/api/documents/${documentId}/comments`));
      if (!res.ok) return;
      const data = await res.json();
      setComments(data.comments ?? []);
      setViewer(data.viewer ?? null);
    } catch {
      // The next tick retries.
    } finally {
      pendingRef.current = false;
      setLoaded(true);
    }
  }, [api, documentId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  /** Guests introduce themselves once, before their first comment. */
  const identify = async () => {
    const name = nameDraft.trim();
    if (!name || !shareToken) return;
    setSavingName(true);
    try {
      const res = await fetch(`/api/shares/${shareToken}/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save that name.");
      setViewer((v) => (v ? { ...v, name: body.name } : v));
      toast.success(`You'll appear as ${body.name}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingName(false);
    }
  };

  const post = async (body: string, parentId: string | null) => {
    const res = await fetch(api(`/api/documents/${documentId}/comments`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, parentId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // 428: the guest has not named themselves yet.
      if (res.status === 428) {
        setViewer((v) => (v ? { ...v, name: null } : v));
      }
      toast.error(err.error ?? "Could not post that comment.");
      throw new Error(err.error ?? "failed");
    }

    const created: Comment = await res.json();
    setComments((prev) => [...prev, created]);
    setReplyTo(null);
  };

  const remove = async (id: string) => {
    const previous = comments;
    setComments((prev) => prev.filter((c) => c.id !== id && c.parentId !== id));
    try {
      const res = await fetch(api(`/api/documents/${documentId}/comments/${id}`), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setComments(previous); // put it back if the server refused
      toast.error("Could not delete that comment.");
    }
  };

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />
      </div>
    );
  }

  const roots = comments.filter((c) => c.parentId === null);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);

  const needsName =
    viewer?.role === "guest" && viewer.canComment && !viewer.name;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {roots.length === 0 ? (
          <div className="space-y-1.5 pt-6 text-center">
            <MessageSquare className="mx-auto h-5 w-5 text-ink-muted" />
            <p className="text-sm text-ink">No comments yet.</p>
            <p className="text-xs text-ink-muted">
              {viewer?.canComment
                ? "Start the discussion below."
                : "This link is view-only."}
            </p>
          </div>
        ) : (
          roots.map((c) => (
            <div key={c.id} className="space-y-2">
              <CommentItem
                comment={c}
                onReply={viewer?.canComment ? () => setReplyTo(c.id) : undefined}
                onDelete={
                  c.mine || viewer?.role === "owner"
                    ? () => void remove(c.id)
                    : undefined
                }
              />

              {repliesOf(c.id).length > 0 && (
                <div className="ml-3 space-y-2 border-l border-rule pl-3">
                  {repliesOf(c.id).map((r) => (
                    <CommentItem
                      key={r.id}
                      comment={r}
                      onDelete={
                        r.mine || viewer?.role === "owner"
                          ? () => void remove(r.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}

              {replyTo === c.id && (
                <div className="ml-3 border-l border-rule pl-3">
                  <CommentComposer
                    compact
                    autoFocus
                    submitLabel="Reply"
                    placeholder={`Reply to ${c.authorName}…`}
                    onSubmit={(body) => post(body, c.id)}
                    onCancel={() => setReplyTo(null)}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {viewer?.canComment && (
        <div className="border-t border-rule p-3">
          {needsName ? (
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">
                What should we call you? Others will see this next to your
                comments.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void identify();
                    }
                  }}
                  placeholder="Your name"
                  maxLength={40}
                  className="text-sm"
                />
                <Button
                  size="sm"
                  onClick={() => void identify()}
                  disabled={savingName || nameDraft.trim().length === 0}
                >
                  {savingName ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Continue"
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <CommentComposer onSubmit={(body) => post(body, null)} />
          )}
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  onReply,
  onDelete,
}: {
  comment: Comment;
  onReply?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-ink">{comment.authorName}</span>
        {comment.isOwner && (
          <span className="rounded bg-accent-sub px-1.5 py-px text-[10px] text-ink-muted">
            owner
          </span>
        )}
        <span className="text-[11px] text-ink-muted">
          {new Date(comment.createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <div className="text-sm leading-relaxed text-ink">
        {renderCommentBody(comment.body)}
      </div>

      <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className="flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
          >
            <Reply className="h-3 w-3" />
            Reply
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 text-[11px] text-ink-muted hover:text-flag"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
