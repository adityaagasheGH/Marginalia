"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Share button + dialog, owner only. Reuses an existing active link rather
 * than minting a new token per click.
 */

type Share = {
  id: string;
  url: string;
  permission: "VIEW" | "COMMENT";
  expiresAt: string | null;
  lastAccessAt: string | null;
};

export function ShareDialog({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  /** Clipboard access can be denied; the link stays selectable either way. */
  const copy = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.message("Copy it from the box below", {
        description: "Your browser blocked clipboard access.",
      });
    }
  }, []);

  /** Fetch-or-create, then copy. Runs when the dialog opens. */
  const ensureLink = useCallback(async () => {
    setBusy(true);
    try {
      const listed = await fetch(`/api/documents/${documentId}/shares`);
      if (listed.ok) {
        const data = await listed.json();
        if (data.shares?.length) {
          setShare(data.shares[0]);
          await copy(data.shares[0].url);
          return;
        }
      }

      const created = await fetch(`/api/documents/${documentId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission: "COMMENT" }),
      });
      if (!created.ok) {
        const body = await created.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not create a link.");
      }
      const fresh = await created.json();
      setShare(fresh);
      await copy(fresh.url);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [documentId, copy]);

  useEffect(() => {
    if (open && !share) void ensureLink();
  }, [open, share, ensureLink]);

  const revoke = async () => {
    if (!share) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/shares/${share.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Could not revoke the link.");
      setShare(null);
      toast.success("Link revoked — it no longer opens.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Link2 className="h-4 w-4" />
          Share
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this document</DialogTitle>
          <DialogDescription>
            Anyone with this link can read the PDF and join the comments. No
            account needed.
          </DialogDescription>
        </DialogHeader>

        {busy && !share ? (
          <div className="flex items-center gap-2 py-4 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating your link…
          </div>
        ) : share ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={share.url}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 shrink-0"
                onClick={() => void copy(share.url)}
                aria-label="Copy link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-[var(--ok)]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>

            <p className="text-xs text-ink-muted">
              {share.lastAccessAt
                ? `Last opened ${new Date(share.lastAccessAt).toLocaleString()}.`
                : "Not opened yet."}{" "}
              Guests can read and comment, but cannot delete the document or
              see your chat.
            </p>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => void revoke()}
              disabled={busy}
              className="gap-1.5 text-flag hover:text-flag"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Revoke this link
            </Button>
          </div>
        ) : (
          <Button onClick={() => void ensureLink()} disabled={busy}>
            Create a share link
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
