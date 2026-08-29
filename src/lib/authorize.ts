import type { SharePermission } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { readGuestCookie } from "@/lib/guest";

/**
 * THE access-control chokepoint.
 *
 * Every route that touches a document resolves its caller through this one
 * function — not a copy-pasted ownership check in eight files. One place to
 * get right, one place to review.
 *
 * Day 1: the owner branch. Day 3 adds the share-token branch for guests.
 * The Viewer union and the share lookup are written now so that extending it
 * is genuinely an extension, not a fork of the logic.
 */

export type Viewer =
  | { role: "owner"; userId: string }
  | {
      role: "guest";
      shareId: string;
      // Null until the guest has introduced themselves. They may read
      // immediately; a name is only required to post.
      guestKey: string | null;
      guestName: string | null;
      permission: SharePermission;
    }
  | null;

/**
 * Resolve who is asking for `documentId`, if anyone is entitled to it.
 *
 * Returns null when the caller has no claim on the document — callers MUST
 * translate null into a 404, never a 403. A 403 confirms the document exists,
 * which is information the requester has not earned.
 */
export async function authorizeDocument(
  documentId: string,
  request: Request,
): Promise<Viewer> {
  // ── 1) Is this the authenticated owner? ────────────────────────────
  const session = await auth();
  if (session?.user?.id) {
    const owned = await db.document.findFirst({
      // Scoped by BOTH id and ownerId: a signed-in user asking for someone
      // else's document id gets null here, exactly like a stranger would.
      where: { id: documentId, ownerId: session.user.id },
      select: { id: true },
    });
    if (owned) {
      return { role: "owner", userId: session.user.id };
    }
  }

  // ── 2) Is there a valid, unrevoked, unexpired share token? ─────────
  const token = new URL(request.url).searchParams.get("token");
  if (token) {
    const share = await db.share.findFirst({
      where: {
        token,
        // Scoping by documentId matters: a valid token for document A must
        // not authorize document B.
        documentId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, permission: true },
    });

    if (share) {
      // The signed httpOnly cookie scoped to this share. Absent until the
      // guest gives a display name, which we only ask for on first comment.
      const identity = await readGuestCookie(share.id);
      return {
        role: "guest",
        shareId: share.id,
        guestKey: identity?.guestKey ?? null,
        guestName: identity?.name ?? null,
        permission: share.permission,
      };
    }
  }

  // ── 3) No claim. Caller returns 404, never 403. ────────────────────
  return null;
}

/** Can this viewer post a comment? Owners always; guests only with COMMENT. */
export function canComment(viewer: Viewer): boolean {
  if (!viewer) return false;
  if (viewer.role === "owner") return true;
  return viewer.permission === "COMMENT";
}

/** Owner-only actions: share, revoke, delete. */
export function isOwner(viewer: Viewer): viewer is { role: "owner"; userId: string } {
  return viewer?.role === "owner";
}
