import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ReaderClient } from "@/app/(app)/documents/[id]/reader-client";

/**
 * /shared/[token] — the page a guest opens. No account, no login.
 *
 * It lives outside the (app) group and outside middleware's matcher, so it is
 * genuinely public. The token in the URL *is* the credential: 256 bits of
 * entropy, checked here and again by the authorizer on every API call the
 * page makes.
 *
 * Why the token and not the document id in the URL: the id is a stable
 * identifier that also appears in the owner's own URLs, and a share link gets
 * forwarded and pasted around. Routing by token means a revoked link becomes
 * inert without exposing the underlying document id at all.
 */
export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const share = await db.share.findFirst({
    where: {
      token,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: {
      id: true,
      documentId: true,
      permission: true,
      document: { select: { id: true, filename: true } },
    },
  });

  // A revoked, expired, or invented token is a 404 — the same response an
  // unknown URL gets. Distinguishing "revoked" from "never existed" would
  // confirm that a document is there for someone probing tokens.
  if (!share) notFound();

  // Record that someone opened the link, for the owner's share list. Failure
  // here must never break the page, so it is fire-and-forget.
  db.share
    .update({ where: { id: share.id }, data: { lastAccessAt: new Date() } })
    .catch(() => {});

  return (
    // Whether this guest may post is decided server-side per request by the
    // comments API, not passed down here — one source of truth, and a prop
    // could not be trusted anyway.
    <ReaderClient documentId={share.documentId} shareToken={token} />
  );
}
