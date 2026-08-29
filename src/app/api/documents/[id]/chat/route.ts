import { NextResponse } from "next/server";
import { streamText } from "ai";
import { db } from "@/lib/db";
import { authorizeDocument, isOwner } from "@/lib/authorize";
import { flash } from "@/lib/ai/client";
import { condenseQuery, type Turn } from "@/lib/ai/condense";
import { hybridSearch, formatContext } from "@/lib/ai/retrieve";
import { CHAT_SYSTEM } from "@/lib/ai/prompts";

/**
 * POST — ask a question about one PDF. GET — load the conversation.
 *
 * condense -> retrieve -> assemble -> generate -> persist. The browser never
 * talks to Gemini; the key stays server-side.
 */

export const maxDuration = 60;

/** Turns kept verbatim. */
const HISTORY_TURNS = 5;

/** Guard against pathological input. */
const MAX_MESSAGE_CHARS = 2000;

type Citation = { chunkId: string; pageStart: number; pageEnd: number };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // null means no claim on this document, and must become 404 — a 403 would
  // confirm the document exists.
  const viewer = await authorizeDocument(id, request);
  if (!viewer) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  // Guest chat is disabled: it is reachable without an account and there is
  // no rate limiting.
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

  // One conversation per (document, user); upsert avoids a create race.
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

  // Rewrite the follow-up into something a search engine can use.
  const searchQuery = await condenseQuery(message, history);

  const hits = await hybridSearch(id, searchQuery);
  const context = formatContext(hits);
  const citations: Citation[] = hits.map((h) => ({
    chunkId: h.id,
    pageStart: h.pageStart,
    pageEnd: h.pageEnd,
  }));

  // Persist the question before generating, so a failure does not lose it.
  await db.chatMessage.create({
    data: { sessionId: session.id, role: "USER", content: message },
  });

  const result = streamText({
    model: flash,
    system: CHAT_SYSTEM(document.filename, document.summary, context),
    messages: history
      .concat({ role: "USER", content: message })
      .map((t) => ({
        role: t.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: t.content,
      })),
    // Extraction, not composition.
    temperature: 0.2,
    maxOutputTokens: 2048,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },

    // Runs after the last token; purely so a reload restores the thread.
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
        console.error(`[chat ${id}] persist failed`, error);
      }
    },
  });

  // Citations go in a header: retrieval completes before the first token,
  // so they are already known and the body stays a plain text stream.
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
