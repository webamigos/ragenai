'use client';

import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { XMarkIcon } from '@heroicons/react/24/outline';

import { Scrim } from '@/components/ui/scrim';
import { getFileIcon } from '@/app/lib/constants/fileIcons';
import { fileTypeFromName } from '@/app/components/ManageKnowledge/DocumentPreview/viewers/file-type-from-name';
import type { RetrievalSource } from '@/store/assistant/assistantSlice';

/**
 * Loaded when a reader opens a source, not when a thread renders.
 *
 * The viewers behind this pull pdf.js and mammoth — well over a megabyte of
 * parser — and every answer in every thread mounts this component. A static
 * import would put that in the chat bundle for a panel most turns never open.
 * `ssr: false` because pdf.js needs a DOM: it reaches for `DOMMatrix` at
 * module scope.
 */
const ViewerForType = dynamic(
  () =>
    import('@/app/components/ManageKnowledge/DocumentPreview/viewers/ViewerForType').then(
      (module) => module.ViewerForType,
    ),
  { ssr: false },
);

type Props = {
  source: RetrievalSource | null;
  onClose: () => void;
};

/**
 * The document behind a citation, opened at the passage the answer used.
 *
 * This is the end of the chain the worker started: Docling reports a box per
 * text element, the anchor walk carries it onto the chunk, the chunk carries it
 * onto the retrieved source, and here it becomes a rectangle over a rendered
 * page. Before it, checking a citation meant leaving the thread, finding the
 * file in the knowledge base and reading until you found the paragraph.
 *
 * **Not `DocumentPreviewSlideOver`.** That component is built around
 * `UserFileTypeSafe` — a full database record — and carries a metadata sidebar
 * with delete, share and move. A cited source has a file id, a name, a page and
 * some rectangles; fetching a record to satisfy a prop type would add a guarded
 * read for data this panel does not show, and offering "delete document" beside
 * a citation is not the action a reader is reaching for. What is shared is the
 * part worth sharing: `ViewerForType` and the viewers under it.
 *
 * **No new read path.** The content comes from `/api/files/{id}`, which already
 * guards on `organizationId` *and* `fileAccessWhere(actor)` — tenancy and
 * authorization as two separate conditions. A reader who cannot download the
 * file sees the viewer's error state, which is the correct outcome rather than
 * a leak.
 *
 * **The highlight can point at unmasked text.** Where PII was masked, the chunk
 * the answer read says `[PESEL]` and the page underneath says the number. That
 * is not new exposure — the same reader can already download that PDF through
 * the same route — but it is a decision: a rectangle can lead someone to text
 * the chunk deliberately masked.
 */

/**
 * What a reader can Tab to inside the panel.
 *
 * Deliberately not a general "is it visible and focusable" test: this panel's
 * contents are a close button and whatever the viewer renders, and a selector
 * is enough for that. `[tabindex="-1"]` is excluded because the panel itself
 * carries it — it is a focus *target*, not a Tab stop.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CitedSourcePreview({ source, onClose }: Props) {
  const t = useTranslations('document-preview');
  const panelRef = useRef<HTMLDivElement>(null);
  /** The control that opened the panel, so closing can hand focus back. */
  const triggerRef = useRef<HTMLElement | null>(null);

  const isOpen = source !== null;
  const fileId = source?.fileId;

  /**
   * Keeps Tab inside the panel.
   *
   * `aria-modal="true"` tells a screen reader the rest of the page is inert;
   * it does nothing to the Tab order. Without this a keyboard user tabs
   * straight out of an open dialog into the thread behind the scrim, where
   * every control is still live and nothing indicates they have left.
   */
  const trapTab = useCallback((event: KeyboardEvent) => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (stops.length === 0) {
      // Nothing to land on — keep focus on the panel rather than letting it
      // escape to the page behind.
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        trapTab(event);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, trapTab]);

  /**
   * Focus in on open, and back to the source card on close.
   *
   * Separate from the effect that moves focus *into* the panel, so switching
   * to another citation without closing does not bounce focus out to the old
   * card and back again.
   */
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      // The card may have been unmounted meanwhile — a thread refetch, a
      // navigation. Restoring to a detached node silently sends focus to
      // `<body>`, which is the same place it would have gone anyway.
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, [isOpen]);

  /** Moves focus into the panel, again when the document behind it changes. */
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    panelRef.current?.focus();
  }, [isOpen, fileId]);

  if (!source) {
    return null;
  }

  const fileName = source.fileName ?? source.fileId;
  const fileType = fileTypeFromName(fileName);

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <Scrim data-testid="cited-source-overlay" onClick={onClose} />

      {/*
        The dialog is the panel, not the panel plus the scrim. The scrim is
        chrome — putting it inside the dialog would make a screen reader
        announce a clickable nothing as the dialog's first child.

        `tabIndex={-1}` makes it a focus target without making it a Tab stop,
        which is what lets focus land here on open and what the Shift+Tab wrap
        checks against.
      */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={fileName}
        className="relative flex h-full w-[90vw] max-w-4xl flex-col bg-card shadow-2xl outline-none dark:bg-muted"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <span className="inline-flex size-6 shrink-0 items-center">
            {getFileIcon(fileType)}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
            title={fileName}
          >
            {fileName}
          </span>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted dark:hover:bg-paper-700"
          >
            <XMarkIcon className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {/*
            The page and the regions come from the same chunk, so the view
            opens where the quote came from. Both are guarded the same way they
            are on the card: a value that arrived over the network and is not a
            page anyone can turn to is dropped rather than passed on.
          */}
          <ViewerForType
            fileType={fileType}
            fileId={source.fileId}
            fileName={fileName}
            contentUrl={`/api/files/${source.fileId}`}
            initialPage={
              typeof source.sourcePage === 'number' &&
              Number.isInteger(source.sourcePage) &&
              source.sourcePage >= 1
                ? source.sourcePage
                : undefined
            }
            highlights={source.sourceRegions}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
