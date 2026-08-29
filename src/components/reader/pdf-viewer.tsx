"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

/**
 * The worker gotcha: react-pdf offloads parsing to a Web Worker, and a
 * CDN-loaded worker fails under a strict CSP. The file is served from
 * /public, same-origin.
 */
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

/**
 * Pages rendered either side of the current one. A 500-page PDF would be
 * unusable if every page mounted a canvas at once, so pages outside the
 * window keep their height but skip rendering.
 */
const RENDER_WINDOW = 2;

export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [current, setCurrent] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pageHeight, setPageHeight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Non-null only while the page box is being edited, so typing "15" does
  // not jump to page 1 on the first keystroke.
  const [pageDraft, setPageDraft] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Suppresses the scroll handler during a programmatic jump, which would
  // otherwise overwrite the target page as the smooth scroll passes over it.
  const jumpingRef = useRef(false);

  const onLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setError(null);
  }, []);

  // Which page is at the top of the viewport, for the indicator and the
  // render window.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !numPages) return;

    let frame = 0;
    const onScroll = () => {
      if (jumpingRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = el.scrollTop + el.clientHeight * 0.3;
        let found = 1;
        for (let i = 0; i < numPages; i++) {
          const node = pageRefs.current[i];
          if (node && node.offsetTop <= top) found = i + 1;
          else break;
        }
        setCurrent(found);
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [numPages]);

  const jumpTo = (page: number) => {
    if (!numPages) return;
    const target = Math.min(Math.max(1, page), numPages);
    setCurrent(target);
    jumpingRef.current = true;
    pageRefs.current[target - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Smooth scrolling has no completion event; release once it has settled.
    window.setTimeout(() => {
      jumpingRef.current = false;
    }, 700);
  };

  /** Apply what was typed in the page box, on Enter or blur. */
  const commitPageDraft = () => {
    if (pageDraft !== null) {
      const n = parseInt(pageDraft, 10);
      if (!Number.isNaN(n)) jumpTo(n);
      setPageDraft(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto rounded-md border border-rule bg-surface p-4"
      >
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
            className="flex flex-col items-center gap-4"
          >
            {Array.from({ length: numPages ?? 0 }, (_, i) => {
              const page = i + 1;
              const inWindow = Math.abs(page - current) <= RENDER_WINDOW;

              return (
                <div
                  key={page}
                  ref={(node) => {
                    pageRefs.current[i] = node;
                  }}
                  data-page={page}
                  className="shadow-sm"
                  // Off-window pages keep the scroll height stable so the
                  // scrollbar does not jump as pages mount and unmount.
                  style={!inWindow && pageHeight ? { height: pageHeight } : undefined}
                >
                  {inWindow ? (
                    <Page
                      pageNumber={page}
                      scale={scale}
                      renderTextLayer
                      renderAnnotationLayer
                      // Any rendered page updates the placeholder height, so
                      // it stays correct after a zoom even when page 1 is
                      // far off screen and not mounted.
                      onRenderSuccess={({ height }) => {
                        setPageHeight((h) =>
                          Math.abs(h - height) > 1 ? height : h,
                        );
                      }}
                      loading={
                        <div
                          className="flex w-full items-center justify-center"
                          style={{ height: pageHeight || 384 }}
                        >
                          <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
                        </div>
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </Document>
        )}
      </div>

      {numPages && (
        <div className="mt-3 flex items-center justify-center gap-4 text-sm text-ink-muted">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={numPages}
              value={pageDraft ?? current}
              onChange={(e) => setPageDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPageDraft();
                }
              }}
              onBlur={commitPageDraft}
              aria-label="Go to page"
              className="h-8 w-14 rounded-md border border-rule bg-paper text-center font-mono text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="font-mono text-xs">/ {numPages}</span>
          </div>

          <span className="h-4 w-px bg-rule" />

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
