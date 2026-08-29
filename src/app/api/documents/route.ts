import { after, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { uploadPdf } from "@/lib/blob";
import { processDocument } from "@/lib/documents/process";

/**
 * /api/documents — list (GET) and upload (POST).
 *
 * maxDuration: the POST kicks off background processing via `after()`, which
 * keeps the serverless function alive until the LLM call finishes. 60s is the
 * Vercel hobby-tier ceiling and comfortably covers a single-pass summary.
 */
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const PDF_MAGIC = "%PDF-"; // every real PDF begins with these five bytes

// ── GET /api/documents ──────────────────────────────────────────────────
// Owner's document list, newest first. Search/pagination come later.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const documents = await db.document.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      status: true,
      summary: true,
      pageCount: true,
      sizeBytes: true,
      errorMessage: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ documents });
}

// ── POST /api/documents ─────────────────────────────────────────────────
// multipart/form-data with a single `file` field.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const ownerId = session.user.id;

  // Parse the multipart body and pull out the file.
  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  // Validation, in order — all of it, not just the first.
  // 1) client-declared MIME type
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "File must be a PDF." }, { status: 400 });
  }
  // 2) extension
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "File must have a .pdf extension." }, { status: 400 });
  }
  // 3) size (cheap check before reading the whole thing into memory)
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit." }, { status: 413 });
  }

  // Read the bytes once. We reuse this same buffer for the magic-byte check,
  // the blob upload, and the background text extraction — no re-download.
  const bytes = new Uint8Array(await file.arrayBuffer());

  // 4) magic bytes — the one check a determined uploader can't fake by
  //    renaming a file. The first five bytes of any real PDF are "%PDF-".
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (header !== PDF_MAGIC) {
    return NextResponse.json(
      { error: "That file isn't a valid PDF." },
      { status: 400 },
    );
  }

  // Generate the id ourselves so the blob pathname and the DB row agree, and
  // so we can hand the id to the background task before the row is queried.
  const documentId = createId();

  // Store the bytes privately, then record the document as PROCESSING.
  let blob;
  try {
    blob = await uploadPdf(ownerId, documentId, bytes);
  } catch (err) {
    console.error("[upload] blob write failed:", err);
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }

  const document = await db.document.create({
    data: {
      id: documentId,
      ownerId,
      filename: sanitizeFilename(file.name),
      blobUrl: blob.url,
      blobPathname: blob.pathname,
      sizeBytes: file.size,
      status: "PROCESSING",
    },
    select: { id: true, filename: true, status: true },
  });

  // Return 201 immediately; process in the background. `after()` runs the
  // callback once the response has been sent, keeping the function alive.
  after(async () => {
    await processDocument(documentId, bytes);
  });

  return NextResponse.json(document, { status: 201 });
}

/**
 * Keep only the base filename, stripped of control characters, for display.
 *
 * Written without any literal backslash or regex escape: a path separator is
 * matched via String.fromCharCode(92), and control characters are dropped by
 * comparing code points. An earlier regex version used a literal backslash
 * that shell/tooling silently corrupted into a malformed character class,
 * which then ate letters out of every filename — hence the defensive style.
 */
function sanitizeFilename(name: string): string {
  const BACKSLASH = String.fromCharCode(92);
  let base = name;
  for (const sep of ["/", BACKSLASH]) {
    const idx = base.lastIndexOf(sep);
    if (idx >= 0) base = base.slice(idx + 1);
  }
  const cleaned = Array.from(base)
    .filter((ch) => ch.charCodeAt(0) >= 32) // drop control chars
    .join("")
    .trim();
  return cleaned.slice(0, 255) || "document.pdf";
}
