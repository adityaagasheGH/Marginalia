import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ReaderClient } from "@/app/(app)/documents/[id]/reader-client";

/**
 * The page a guest opens. Outside middleware's matcher, so genuinely public.
 * The token is the credential, re-checked by the authorizer on every call.
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

  // Revoked, expired, and invented tokens are all 404.
  if (!share) notFound();

  // Fire-and-forget: a failure here must not break the page.
  db.share
    .update({ where: { id: share.id }, data: { lastAccessAt: new Date() } })
    .catch(() => {});

  return (
    <ReaderClient documentId={share.documentId} shareToken={token} />
  );
}
