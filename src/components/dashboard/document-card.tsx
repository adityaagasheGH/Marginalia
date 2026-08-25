"use client";

import Link from "next/link";
import { FileText, Loader2, AlertTriangle, ScanLine } from "lucide-react";
import { Card } from "@/components/ui/card";

/** The document shape the dashboard list endpoint returns. */
export type DocumentSummary = {
  id: string;
  filename: string;
  status: "PROCESSING" | "READY" | "NO_TEXT" | "FAILED";
  summary: string | null;
  pageCount: number | null;
  sizeBytes: number;
  errorMessage: string | null;
  createdAt: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** A small coloured pill describing where the document is in the pipeline. */
function StatusBadge({ status }: { status: DocumentSummary["status"] }) {
  if (status === "READY") return null; // a ready card shows its summary instead

  const map = {
    PROCESSING: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      label: "Analyzing…",
      cls: "text-ink-muted",
    },
    NO_TEXT: {
      icon: <ScanLine className="h-3.5 w-3.5" />,
      label: "No extractable text",
      cls: "text-flag",
    },
    FAILED: {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      label: "Processing failed",
      cls: "text-flag",
    },
  } as const;

  const { icon, label, cls } = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

export function DocumentCard({ doc }: { doc: DocumentSummary }) {
  return (
    // The whole card opens the reader (docs/UI_SPEC.md dashboard flow). The
    // reader page itself handles PROCESSING/FAILED/NO_TEXT states, so it's
    // safe to link there regardless of status.
    <Link href={`/documents/${doc.id}`} className="block h-full">
      <Card className="flex h-full flex-col gap-3 p-5 transition-colors hover:border-ink-muted">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-medium text-ink" title={doc.filename}>
              {doc.filename}
            </h3>
            <p className="text-xs text-ink-muted">
              {doc.pageCount ? `${doc.pageCount} pages · ` : ""}
              {formatDate(doc.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex-1">
          {doc.status === "READY" && doc.summary ? (
            <p className="line-clamp-4 text-sm text-ink-muted">{doc.summary}</p>
          ) : doc.status === "PROCESSING" ? (
            <StatusBadge status="PROCESSING" />
          ) : (
            <div className="space-y-1">
              <StatusBadge status={doc.status} />
              {doc.errorMessage && (
                <p className="text-xs text-ink-muted">{doc.errorMessage}</p>
              )}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
