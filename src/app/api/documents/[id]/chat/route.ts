import { NextResponse } from "next/server";
import { streamText } from "ai";
import { db } from "@/lib/db";
import { authorizeDocument, isOwner } from "@/lib/authorize";
import { flash } from "@/lib/ai/client";
import { condenseQuery, type Turn } from "@/lib/ai/condense";
import { hybridSearch, formatContext } from "@/lib/ai/retrieve";
import { CHAT_SYSTEM } from "@/lib/ai/prompts";

/**
 * POST /api/documents/[id]/chat — ask a question about one PDF.
 * GET  /api/documents/[id]/chat — load this document's conversation.
 *
 * An "API route" is a file that runs on the server and answers HTTP requests.
 * The browser never talks to Gemini: it posts here, this code calls Gemini
 * with the server-held key, and streams the answer back. That is what keeps
 * the API key off the client, which the assignment requires explicitly.
 *
 * The RAG pipeline, in order:
 *   1. CONDENSE  follow-up + history -> standalone query   (lib/ai/condense)
 *   2. RETRIEVE  hybrid vector + keyword search -> 6 chunks (lib/ai/retrieve)
 *   3. ASSEMBLE  numbered excerpts with page ranges
 *   4. GENERATE  stream the answer, grounded in those excerpts
 *   5. PERSIST   save both messages so the conversation survives a reload
 */

// Streaming plus two model calls can exceed the default 15s serverless limit.
export const maxDuration = 60;

/** Turns kept verbatim. The assignment asks for 3-5; 5 is the upper end. */
const HISTORY_TURNS = 5;

/** Longest question we accept — a guard against pathological input. */
const MAX_MESSAGE_CHARS = 2000;

type Citation = { chunkId: string; pageStart: number; pageEnd: number };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Same chokepoint every document route uses. null means "no claim on this
  // document" and must become a 404 — a 403 would confirm the document
  // exists, which the caller has not earned (docs/SECURITY.md).
  const viewer = await authorizeDocument(id, request);
  if (!viewer) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  // Guest chat needs a per-browser session key that Day 3 introduces along
  // with sharing. Until then only the owner can chat.
  if (!isOwner(viewer)) {
    return NextResponse.json(
      { error: "Chat is not available on shared links yet." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message =
    typeof body === "object" && body !== null && "message" in body
      ? String((body as { message: unknown }).message ?? "").trim()
      : "";

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Questions are limited to ${MAX_MESSAGE_CHARS} characters.` },
      { status: 400 },
    );
  }

  const document = await db.document.findUnique({
    where: { id },
    select: { filename: true, summary: true, status: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (document.status !== "READY") {
    return NextResponse.json(
      {
        error:
          document.status === "NO_TEXT"
            ? "This PDF has no extractable text, so it can't be searched."
            : "This document is still being processed.",
      },
      { status: 409 },
    );
  }

  // One conversation per (document, user). upsert avoids a race where two
  // quick messages would each try to create the session row.
  const session = await db.chatSession.upsert({
    where: { documentId_userId: { documentId: id, userId: viewer.userId } },
    create: { documentId: id, userId: viewer.userId },
    update: {},
    select: { id: true },
  });

  const recent = await db.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS * 2, // a "turn" is a question and its answer
    select: { role: true, content: true },
  });
  const history: Turn[] = recent.reverse();

  // ── 1. Condense ───────────────────────────────────────────────────────
  // "And what about renewal?" is meaningless to a search engine. Rewritten
  // against the history it becomes a query that actually retrieves.
  const searchQuery = await condenseQuery(message, history);

  // ── 2. Retrieve ───────────────────────────────────────────────────────
  const hits = await hybridSearch(id, searchQuery);
  const context = formatContext(hits);
  const citations: Citation[] = hits.map((h) => ({
    chunkId: h.id,
    pageStart: h.pageStart,
    pageEnd: h.pageEnd,
  }));

  // Persist the question now, not after the answer. If generation fails the
  // user still sees what they asked rather than a conversation that silently
  // dropped their message.
  await db.chatMessage.create({
    data: { sessionId: session.id, role: "USER", content: message },
  });

  // ── 3+4. Assemble and generate ────────────────────────────────────────
  const result = streamText({
    model: flash,
    system: CHAT_SYSTEM(document.filename, document.summary, context),
    messages: history
      .concat({ role: "USER", content: message })
      .map((t) => ({
        role: t.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: t.content,
      })),
    // Low: this is extraction from supplied text, not composition. Higher
    // values invite the model to embellish, which here means hallucinate.
    temperature: 0.2,
    maxOutputTokens: 2048,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },

    // ── 5. Persist ──────────────────────────────────────────────────────
    // Runs after the last token is streamed. The user already has the full
    // answer on screen by then; this is purely so a reload restores it.
    onFinish: async ({ text }) => {
      try {
        await db.chatMessage.create({
          data: {
            sessionId: session.id,
            role: "ASSISTANT",
            content: text,
            citations,
          },
        });
        await db.chatSession.update({
          where: { id: session.id },
          data: { updatedAt: new Date() },
        });
      } catch (error) {
        // The user has their answer; losing the transcript row must not
        // surface as a broken response.
        console.error(`[chat ${id}] persist failed`, error);
      }
    },
  });

  // Citations travel in a header rather than the body because retrieval
  // completes before the first token exists — so they are already known, and
  // this keeps the body a plain text stream the client can render directly.
  return result.toTextStreamResponse({
    headers: {
      "X-Citations": JSON.stringify(citations),
      "X-Search-Query": encodeURIComponent(searchQuery),
      "Cache-Control": "no-store",
    },
  });
}

/** Load the saved conversation so a page reload does not lose it. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const viewer = await authorizeDocument(id, request);
  if (!viewer) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!isOwner(viewer)) {
    return NextResponse.json({ messages: [] });
  }

  const session = await db.chatSession.findUnique({
    where: { documentId_userId: { documentId: id, userId: viewer.userId } },
    select: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, citations: true },
      },
    },
  });

  return NextResponse.json({ messages: session?.messages ?? [] });
}
