import type { FileType } from '@/generated/prisma/browser';

/**
 * The file type a name implies.
 *
 * A cited source carries a file id and a file name and nothing else — the
 * chunk payload never held a type. Reading one out of the database would mean
 * a second guarded query for a value the extension already states, so the name
 * is what decides which viewer opens.
 *
 * Wrong only when a file is misnamed, and the cost of being wrong is bounded:
 * every viewer here renders from `/api/files/{id}`, so a mismatch shows the
 * unsupported placeholder with its download link rather than failing. `UNKNOWN`
 * is the honest answer for an extension nothing here can render.
 *
 * In its own file, away from `ViewerForType`, so a caller can ask what a name
 * is without pulling pdf.js and mammoth into its module graph — which is the
 * difference between the chat route loading a megabyte of parser it may never
 * use and loading it when a reader opens a source.
 */
const EXTENSIONS: Record<string, FileType> = {
  pdf: 'PDF',
  docx: 'DOCX',
  doc: 'DOCX',
  md: 'MARKDOWN',
  markdown: 'MARKDOWN',
  txt: 'TEXT',
  csv: 'CSV',
  xlsx: 'XLSX',
  epub: 'EPUB',
  srt: 'SRT',
  pptx: 'PPTX',
  png: 'IMAGE',
  jpg: 'IMAGE',
  jpeg: 'IMAGE',
  gif: 'IMAGE',
  webp: 'IMAGE',
};

export function fileTypeFromName(fileName: string): FileType {
  const extension = fileName.toLowerCase().split('.').pop();
  return (extension && EXTENSIONS[extension]) || 'UNKNOWN';
}
