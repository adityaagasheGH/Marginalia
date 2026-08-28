"use client";

import { useState, type ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * An in-app confirmation dialog for destructive actions.
 *
 * Replaces window.confirm(), which is a *browser* dialog rather than part of
 * the app: it is titled "localhost:3000 says", ignores every stylesheet, and
 * blocks the page thread until dismissed. This is a real React component, so
 * it follows the theme, animates, traps focus, and can show a loading state
 * while the action runs — none of which native confirm can do.
 *
 * Three deliberate choices for a destructive prompt:
 *
 *  - **No X in the corner.** The only ways out are Cancel or Confirm, so the
 *    choice is explicit. (Escape and clicking the overlay still cancel, which
 *    is what users expect and is the *safe* direction.)
 *  - **Cancel takes initial focus.** The dangerous button is never one stray
 *    Enter away.
 *  - **The dialog stays open while the action runs**, showing a spinner in the
 *    confirm button. Closing first would leave the user unsure whether it
 *    worked.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  detail,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line on what is about to happen. */
  description: ReactNode;
  /** Optional extra block — e.g. what else gets removed alongside. */
  detail?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      // Reset even on failure: the dialog stays open so the user can retry
      // or back out, rather than being stuck on a dead spinner.
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Ignore dismissal attempts mid-action — closing the dialog while the
        // request is in flight would hide the outcome.
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {/* A tinted disc rather than a bare icon: it reads as a warning at
                a glance without shouting, and matches the destructive token. */}
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <TriangleAlert className="h-4.5 w-4.5 text-destructive" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <DialogTitle className="text-base">{title}</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {detail && <div className="pl-12">{detail}</div>}

        <DialogFooter>
          <Button
            variant="outline"
            // Initial focus lands here, so Enter cancels rather than destroys.
            autoFocus
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void run()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Deleting…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
