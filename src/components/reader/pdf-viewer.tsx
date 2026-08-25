"use client";

import { useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

/**
 * The worker gotcha (docs/UI_SPEC.md): react-pdf offloads parsing to a Web
 * Worker. A CDN-loaded worker fails under a strict CSP — the classic "works
 * locally, breaks in production" bug. The worker file is copied to
 * /public/pdf.worker.min.mjs (see scripts note below) and loaded from there,
 * same-origin, so no CDN and no CSP surprise.
 */
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState<string | null>(null);

  const onLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setError(null);
  }, []);

  return (
    <div className="flex h-full flex-col items-center">
      <div className="flex-1 overflow-auto rounded-md border border-rule bg-surface p-4">
        {error ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="text-sm text-flag">{error}</p>
          </div>
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={onLoadSuccess}
            onLoadError={(err) => setError(`Couldn't load the PDF: ${err.message}`)}
            loading={
              <div className="flex h-96 w-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer
              renderAnnotationLayer
              loading={
                <div className="flex h-96 w-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
                </div>
              }
            />
          </Document>
        )}
      </div>

      {numPages && (
        <div className="mt-3 flex items-center gap-4 text-sm text-ink-muted">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[5rem] text-center font-mono text-xs">
            {pageNumber} / {numPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={pageNumber >= numPages}
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <span className="mx-2 h-4 w-px bg-rule" />

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={scale <= 0.5}
            onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="min-w-[3.5rem] text-center font-mono text-xs">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={scale >= 2.0}
            onClick={() => setScale((s) => Math.min(2.0, s + 0.1))}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
