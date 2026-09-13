'use client';

import type { SourceRegion } from '@ragenai/rag-core';

import type { FileType } from '@/generated/prisma/browser';
import { PdfViewer } from './PdfViewer';
import { DocxViewer } from './DocxViewer';
import { MarkdownViewer } from './MarkdownViewer';
import { PlainTextViewer } from './PlainTextViewer';
import { ImageViewer } from './ImageViewer';
import { UnsupportedViewer } from './UnsupportedViewer';

/**
 * Picks the viewer for a file.
 *
 * Lived inside `DocumentPreviewSlideOver` until the chat needed it too. That
 * component is built around `UserFileTypeSafe` — a full database record, with
 * a metadata sidebar and delete/share/move actions — and a cited source in a
 * thread has a file id and a name. Importing the slide-over to reach this
 * function would have dragged the knowledge base's table types into the chat
 * bundle for a switch statement.
 */
export function ViewerForType({
  fileType,
  fileId,
  fileName,
  contentUrl,
  initialPage,
  highlights,
}: {
  fileType: FileType;
  fileId: string;
  fileName: string;
  contentUrl: string;
  /** PDF only: the page to open at. Ignored by every other viewer. */
  initialPage?: number;
  /** PDF only: the regions to highlight. Ignored by every other viewer. */
  highlights?: SourceRegion[];
}) {
  if (fileType === 'PDF') {
    return (
      <PdfViewer
        contentUrl={contentUrl}
        initialPage={initialPage}
        highlights={highlights}
      />
    );
  }
  if (fileType === 'DOCX') {
    return <DocxViewer contentUrl={contentUrl} />;
  }
  if (fileType === 'MARKDOWN') {
    return <MarkdownViewer contentUrl={contentUrl} />;
  }
  if (fileType === 'TEXT' || fileType === 'CSV') {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
      return <DocxViewer contentUrl={contentUrl} />;
    }
    if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
      return <MarkdownViewer contentUrl={contentUrl} />;
    }
    return <PlainTextViewer contentUrl={contentUrl} />;
  }
  if (fileType === 'IMAGE') {
    return <ImageViewer contentUrl={contentUrl} fileName={fileName} />;
  }
  return <UnsupportedViewer fileId={fileId} fileName={fileName} />;
}
