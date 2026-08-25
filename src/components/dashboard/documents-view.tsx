"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DocumentCard, type DocumentSummary } from "./document-card";

/**
 * The dashboard's interactive core (client component).
 *
 * - Loads the document list from GET /api/documents.
 * - Uploads via POST /api/documents, optimistically showing a PROCESSING
 *   card the instant the 201 returns.
 * - Polls every 3s while ANY card is still PROCESSING, then stops. Polling is
 *   simple and works everywhere; no websocket infrastructure (BLUEPRINT § 4).
 */
export function DocumentsView() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/documents");
    if (res.ok) {
      const data = (await res.json()) as { documents: DocumentSummary[] };
      setDocs(data.documents);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is processing.
  useEffect(() => {
    const anyProcessing = docs.some((d) => d.status === "PROCESSING");
    if (!anyProcessing) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [docs, load]);

  const upload = useCallback(
    async (file: File) => {
      // Cheap client-side guard for instant feedback; the server re-checks.
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        toast.error("That doesn't look like a PDF.");
        return;
      }
      setUploading(true);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/documents", { method: "POST", body });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(data.error ?? "Upload failed.");
          return;
        }
        const created = (await res.json()) as DocumentSummary;
        // Optimistic insert so the PROCESSING card appears immediately; the
        // poll then fills in pageCount/summary once processing finishes.
        setDocs((prev) => [
          {
            ...created,
            summary: null,
            pageCount: null,
            sizeBytes: file.size,
            errorMessage: null,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        toast.success("Uploaded. Analyzing…");
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) upload(file);
    },
    [upload],
  );

  return (
    <div className="space-y-6">
      {/* Upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center transition-colors ${
          dragging ? "border-primary bg-accent-sub/40" : "border-rule hover:border-ink-muted"
        }`}
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
        ) : (
          <Upload className="h-6 w-6 text-ink-muted" />
        )}
        <p className="text-sm text-ink">
          {uploading ? "Uploading…" : "Drop a PDF here, or click to choose"}
        </p>
        <p className="text-xs text-ink-muted">Up to 25 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-ink-muted">Loading your documents…</p>
      ) : docs.length === 0 ? (
        <div className="rounded-md border border-rule bg-surface p-10 text-center">
          <p className="font-serif text-lg text-ink">Nothing here yet.</p>
          <p className="mt-1 text-sm text-ink-muted">
            Drop in a PDF and we&apos;ll read it for you.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}
