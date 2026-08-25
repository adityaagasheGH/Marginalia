"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SummaryPanel } from "@/components/reader/summary-panel";
import { ComingSoonPanel } from "@/components/reader/coming-soon-panel";

/**
 * pdfjs-dist (which react-pdf wraps) expects browser-only globals like
 * `document` and `DOMMatrix`. Next.js server-renders client components on
 * first load regardless of "use client", so importing PdfViewer normally
 * crashes the server render with "Object.defineProperty called on
 * non-object". `ssr: false` skips the server pass entirely for this
 * component — it only ever mounts in the browser.
 */
const PdfViewer = dynamic(
  () => import("@/components/reader/pdf-viewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center rounded-md border border-rule bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
      </div>
    ),
  },
);

type DocumentMeta = {
  id: string;
  filename: string;
  status: "PROCESSING" | "READY" | "NO_TEXT" | "FAILED";
  summary: string | null;
  pageCount: number | null;
  errorMessage: string | null;
};

/**
 * The reader: PDF centred, a tabbed sidebar (Summary / Chat / Comments) to
 * its right. Client component because it fetches document metadata and
 * drives the PDF viewer's page/zoom state.
 */
export function ReaderClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentMeta | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${params.id}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        setDoc(await res.json());
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (notFound) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-paper px-4 text-center">
        <p className="font-serif text-xl text-ink">Document not found.</p>
        <Button variant="outline" onClick={() => router.push("/dashboard")}>
          Back to dashboard
        </Button>
      </main>
    );
  }

  if (!doc) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col bg-paper">
      <header className="flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-medium text-ink">{doc.filename}</h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <div className="min-h-0 flex-1">
          {doc.status === "READY" || doc.status === "NO_TEXT" ? (
            <PdfViewer fileUrl={`/api/documents/${doc.id}/file`} />
          ) : doc.status === "PROCESSING" ? (
            <div className="flex h-full items-center justify-center gap-2 rounded-md border border-rule bg-surface text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Still analyzing this document…
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-rule bg-surface p-8 text-center text-sm text-flag">
              {doc.errorMessage ?? "This document couldn't be processed."}
            </div>
          )}
        </div>

        <aside className="flex w-full flex-col rounded-md border border-rule bg-surface lg:w-[380px] lg:shrink-0">
          <Tabs defaultValue="summary" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="w-full justify-start rounded-none border-b border-rule bg-transparent p-0">
              <TabsTrigger value="summary" className="flex-1">Summary</TabsTrigger>
              <TabsTrigger value="chat" className="flex-1">Chat</TabsTrigger>
              <TabsTrigger value="comments" className="flex-1">Comments</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="min-h-0 flex-1 overflow-auto">
              <SummaryPanel summary={doc.status === "NO_TEXT" ? doc.errorMessage : doc.summary} />
            </TabsContent>
            <TabsContent value="chat" className="min-h-0 flex-1 overflow-auto">
              <ComingSoonPanel label="Chat" />
            </TabsContent>
            <TabsContent value="comments" className="min-h-0 flex-1 overflow-auto">
              <ComingSoonPanel label="Comments" />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </main>
  );
}
