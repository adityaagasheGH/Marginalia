/**
 * Backfill chat indexes for documents uploaded before chat existed.
 *
 *   node scripts/backfill-chunks.mjs            # index anything with 0 chunks
 *   node scripts/backfill-chunks.mjs --all      # re-index everything
 *   node scripts/backfill-chunks.mjs <id> ...   # index specific documents
 *
 * Ingest now chunks and embeds on upload, but documents already in the
 * database were processed by the old pipeline and have no chunks at all —
 * chat would retrieve nothing and answer nothing. This re-downloads each
 * PDF, re-extracts its text, and builds the index.
 *
 * Safe to re-run: replaceChunks deletes a document's existing chunks and
 * reinserts inside one transaction, so a document is never left half-indexed.
 *
 * Written as .mjs to match the other scripts here, and it imports the real
 * app modules (via a small "@/" resolver) rather than duplicating chunking
 * logic — a second copy would drift from the pipeline it is meant to mirror.
 */
import { registerHooks } from "node:module";
import { get } from "@vercel/blob";

process.loadEnvFile(".env");

// Next.js resolves the "@/..." alias from tsconfig; plain node does not.
// import.meta.url is already a file:// URL — do not run it through
// pathToFileURL, which on Windows turns /C:/... into file:///C:/C:/...
const SRC = new URL("../src/", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      let target = new URL(specifier.slice(2), SRC).href;
      if (!/\.[a-z]+$/.test(target)) target += ".ts";
      return { url: target, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { db } = await import("@/lib/db");
const { extractPdfText } = await import("@/lib/pdf/extract");
const { indexDocument } = await import("@/lib/documents/process");

const args = process.argv.slice(2);
const all = args.includes("--all");
const ids = args.filter((a) => !a.startsWith("--"));

const where = ids.length
  ? { id: { in: ids } }
  : all
    ? { status: "READY" }
    : { status: "READY", chunks: { none: {} } };

const documents = await db.document.findMany({
  where,
  select: { id: true, filename: true, blobUrl: true, _count: { select: { chunks: true } } },
  orderBy: { createdAt: "asc" },
});

if (documents.length === 0) {
  console.log("Nothing to index. Every READY document already has chunks.");
  await db.$disconnect();
  process.exit(0);
}

console.log(`Indexing ${documents.length} document(s)...\n`);

let ok = 0;
let failed = 0;

for (const doc of documents) {
  const label = doc.filename.length > 50 ? `${doc.filename.slice(0, 47)}...` : doc.filename;
  process.stdout.write(`  ${label.padEnd(52)} `);

  try {
    // The blob is private, so it is fetched server-side with credentials —
    // exactly as the /file route does. There is no public URL to curl.
    const blob = await get(doc.blobUrl, { access: "private" });
    if (!blob || blob.statusCode !== 200) throw new Error("blob fetch failed");

    const bytes = new Uint8Array(await new Response(blob.stream).arrayBuffer());
    const { pages } = await extractPdfText(bytes);
    const count = await indexDocument(doc.id, pages);

    console.log(`${String(count).padStart(3)} chunks  (was ${doc._count.chunks})`);
    ok++;
  } catch (error) {
    console.log(`FAILED - ${error.message}`);
    failed++;
  }
}

const total = await db.documentChunk.count();
console.log(`\nDone. ${ok} indexed, ${failed} failed. ${total} chunks in the database.`);

await db.$disconnect();
process.exit(failed > 0 ? 1 : 0);
