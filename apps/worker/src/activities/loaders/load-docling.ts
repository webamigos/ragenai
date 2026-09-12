import type { Document } from '../../types/Document';
import { convertWithDocling } from '../../services/docling-client';
import { logger } from '../../services/logger';
import {
  ensureLocalFile,
  type FileLocator,
} from '../../services/ensure-local-file';
import { type FileType } from '../../types/UserFile';

type LoadDoclingParams = FileLocator & {
  fileType: FileType;
};

/**
 * Parses a document using Docling (docling-serve REST API).
 *
 * Docling converts the file to high-quality Markdown with layout understanding,
 * table extraction, and heading hierarchy. The returned Document uses the
 * Markdown content as pageContent so it can be split by the heading-aware
 * markdown splitter.
 *
 * For spreadsheets (XLSX/CSV), Docling produces Markdown tables rather than
 * raw CSV, which means the output goes through the markdown splitter instead
 * of the CSV row-group splitter. This was called intentional when it was
 * written; `docs/lessons/docling-routes-spreadsheets-past-the-csv-splitter.md`
 * records what it costs — ADR-17's repeated header no longer reaches the two
 * file types it was written for.
 */
export const loadDocling = async ({
  orgId,
  fileId,
  fileName,
  fileType,
}: LoadDoclingParams): Promise<Document[]> => {
  logger.info({ fileId, fileName, fileType }, 'Loading document with Docling');

  const filePath = await ensureLocalFile({ orgId, fileId, fileName });

  const { markdown, pageCount, pageAnchors, tables, elementLabels } =
    await convertWithDocling(filePath, fileName, {
      doOcr: true,
      tableMode: 'accurate',
      imageExportMode: 'placeholder',
    });

  return [
    {
      pageContent: markdown,
      metadata: {
        source: filePath,
        fileType,
        fileName,
        parser: 'docling',
        // The parser's own page count, carried so the workflow can use it
        // instead of guessing from character count. Absent for formats that
        // have no pages; the workflow falls back only then.
        ...(pageCount !== null ? { doclingPageCount: pageCount } : {}),
        // Where each page starts in this markdown, so the splitter can give
        // every chunk the page it actually came from.
        ...(pageAnchors.length > 0 ? { doclingPageAnchors: pageAnchors } : {}),
        // The parsed tables, riding the same channel. `convertWithDocling` is
        // the only place `json_content` exists and the splitter is two modules
        // further on, so `doc.metadata` is the transport — the one
        // `doclingPageAnchors` already established. Spread conditionally, so a
        // document with no tables carries no key at all and its chunks are
        // byte-identical to before this existed.
        ...(tables.length > 0 ? { doclingTables: tables } : {}),
        ...(Object.keys(elementLabels).length > 0
          ? { doclingElementLabels: elementLabels }
          : {}),
      },
    },
  ];
};
