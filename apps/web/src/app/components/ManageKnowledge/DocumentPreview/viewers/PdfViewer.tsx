'use client';

import { useState, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { useTranslations } from 'next-intl';
import type { SourceRegion } from '@ragenai/rag-core';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
} from '@heroicons/react/24/outline';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Props = {
  contentUrl: string;
  /**
   * The page to open at, 1-based. Clamped once the real page count is known,
   * because it comes from a chunk's metadata and a document can be re-indexed
   * or replaced between the two.
   *
   * Absent means "start at the beginning", which is every existing caller.
   */
  initialPage?: number;
  /**
   * Rectangles to draw over the page, as top-left-origin fractions of the page
   * box — the shape the worker normalised at ingest.
   *
   * These mark **paragraphs**, not sentences: Docling's boxes are per element,
   * and the first one in a typical document spans the full column width. The
   * legend says so rather than implying a precision the parser cannot deliver.
   *
   * Only the ones on the page being shown are drawn. Absent or empty renders
   * exactly as before, which is what every existing caller gets.
   */
  highlights?: SourceRegion[];
};

/** Keeps a requested page inside a document that may have been re-indexed. */
const clampPage = (page: number, numPages: number) =>
  numPages > 0 ? Math.min(Math.max(page, 1), numPages) : Math.max(page, 1);

export function PdfViewer({ contentUrl, initialPage, highlights }: Props) {
  const t = useTranslations('document-preview');
  const [numPages, setNumPages] = useState<number>(0);
  /**
   * What was asked for, not what is shown.
   *
   * The page actually rendered is this clamped to the page count, derived
   * below rather than stored. Storing the clamped value needs the count at the
   * moment of every write, and the count arrives asynchronously — so a request
   * that landed first would be clamped against `0` and stick. Deriving it
   * means the clamp re-runs for free the moment the real count exists.
   */
  const [requestedPage, setRequestedPage] = useState(initialPage ?? 1);
  const [scale, setScale] = useState(1.0);
  const [error, setError] = useState(false);

  const pageNumber = clampPage(requestedPage, numPages);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      setRequestedPage(initialPage ?? 1);
      setScale(1.0);
    },
    [initialPage],
  );

  // A different source was activated while the viewer stayed open. Following
  // the prop rather than ignoring it is the whole point of opening at a page:
  // the second citation a reader clicks must move the view.
  //
  // `undefined` means the beginning, on an update as much as on mount — that
  // is what the prop documents. Ignoring it here would leave the previous
  // source's page showing for a citation that has no page. Today the two
  // sources are always different files, so the reload resets it anyway; that
  // is a property of the dedupe in `operations.ts`, not of this component.
  useEffect(() => {
    setRequestedPage(initialPage ?? 1);
  }, [initialPage]);

  const pageHighlights = (highlights ?? []).filter(
    (region) => region.page === pageNumber,
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-destructive">
        {t('error-loading')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRequestedPage(Math.max(1, pageNumber - 1))}
            disabled={pageNumber <= 1}
            aria-label={t('prev-page')}
            className="rounded p-1 hover:bg-paper-200 disabled:opacity-40 dark:hover:bg-paper-700"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <span className="text-sm text-muted-foreground">
            {t('page')} {pageNumber} {t('of')} {numPages}
          </span>
          <button
            onClick={() => setRequestedPage(Math.min(numPages, pageNumber + 1))}
            disabled={pageNumber >= numPages}
            aria-label={t('next-page')}
            className="rounded p-1 hover:bg-paper-200 disabled:opacity-40 dark:hover:bg-paper-700"
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
        {pageHighlights.length > 0 ? (
          // Says what a rectangle means, and says "paragraph" on purpose:
          // Docling's boxes are per element, so promising the sentence would
          // be promising something the parser never produced.
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t('highlight-legend')}
          </span>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            aria-label={t('zoom-out')}
            className="rounded p-1 hover:bg-paper-200 dark:hover:bg-paper-700"
          >
            <MagnifyingGlassMinusIcon className="size-4" />
          </button>
          <span className="text-sm text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(3, s + 0.25))}
            aria-label={t('zoom-in')}
            className="rounded p-1 hover:bg-paper-200 dark:hover:bg-paper-700"
          >
            <MagnifyingGlassPlusIcon className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-muted dark:bg-card">
        <div className="flex justify-center p-4">
          <Document
            file={contentUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={() => setError(true)}
            loading={
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                {t('loading')}
              </div>
            }
          >
            {/*
              The overlay is positioned against this wrapper, which is exactly
              the size of the rendered page. Percentages then need no
              arithmetic: the worker already converted every box to a fraction
              of the page box, so a rectangle lands correctly at any `scale`
              without the component knowing the page size or the parser's
              coordinate origin.
            */}
            <div className="relative inline-block shadow-lg">
              <Page pageNumber={pageNumber} scale={scale} />
              {pageHighlights.length > 0 ? (
                <div
                  // Decorative: the legend above carries the meaning, and a
                  // screen reader reading out eight empty boxes would be
                  // noise over the page text it already has.
                  aria-hidden="true"
                  data-testid="pdf-highlights"
                  className="pointer-events-none absolute inset-0"
                >
                  {pageHighlights.map((region, index) => (
                    <div
                      key={`${region.page}-${region.x}-${region.y}-${index}`}
                      className="absolute rounded-xs bg-primary/20 ring-1 ring-primary/50"
                      style={{
                        left: `${region.x * 100}%`,
                        top: `${region.y * 100}%`,
                        width: `${region.w * 100}%`,
                        height: `${region.h * 100}%`,
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </Document>
        </div>
      </div>
    </div>
  );
}
