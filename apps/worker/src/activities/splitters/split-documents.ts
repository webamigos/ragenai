import {
  attachSourcePages,
  type PageAnchor,
} from '../../services/text-splitters/source-pages';
import { buildTableChunks } from '../../services/text-splitters/table-chunks';
import type { DoclingTable } from '../../services/docling-client';
import { type Document } from '../../types/Document';
import {
  splitCsvDocuments,
  splitDocuments,
  splitDocxDocuments,
  splitMarkdownDocuments,
  splitPdfDocuments,
} from '../../services/text-splitters';
import { FileType } from '../../types/UserFile';
import { type SplitterSettings } from '../../utils/splitters';
import { logger } from '../../services/logger';

/**
 * The keys that carried Docling's parse from the loader to here.
 *
 * The splitter copies a document's metadata onto every chunk it cuts, so
 * without this the whole parsed table — every cell, on a sixty-row schedule —
 * rides on each of the document's chunks across the activity boundary, and
 * again on the way to `prepareMetadata`, which drops them all. `pageAnchors`
 * has always done this at a smaller scale; tables would make it an order of
 * magnitude worse, and Temporal has a payload limit that a long document could
 * reach.
 *
 * Nothing downstream reads them off a chunk: the page count is read off
 * `rawDocs[0]` by the workflow, the anchors and the tables off `rawDocs[0]`
 * here.
 */
const TRANSPORT_KEYS = [
  'doclingPageAnchors',
  'doclingTables',
  'doclingElementLabels',
  'doclingPageCount',
] as const;

function withoutTransport(chunks: Document[]): Document[] {
  return chunks.map((chunk) => {
    if (!TRANSPORT_KEYS.some((key) => key in chunk.metadata)) {
      return chunk;
    }
    const metadata = { ...chunk.metadata };
    for (const key of TRANSPORT_KEYS) {
      delete metadata[key];
    }
    return { ...chunk, metadata };
  });
}

type SplitTextParams = {
  fileType: FileType;
  rawDocs: Document[];
  splitterSettings: SplitterSettings;
  /** When true, all output is Markdown from Docling — use the markdown splitter. */
  parsedWithDocling?: boolean;
};

/**
 * Dispatches to type-specific chunking strategies (ADR-17, ADR-18).
 *
 * - MARKDOWN → heading-aware markdown splitter
 * - CSV / XLSX → row-group splitter (header row repeated in every chunk)
 * - DOCX → heading-aware HTML splitter (preserves section_path)
 * - PDF → section-aware splitter: Claude structured output already
 *   produces pre-chunked sections with sectionPath (ADR-18); the splitter
 *   passes through sections that fit the budget and recursively splits
 *   those that don't while preserving sectionPath on sub-chunks
 * - SRT → pre-chunked by the loader's LLM segmentation, pass-through
 * - everything else → generic recursive character splitter
 */
export const splitText = async ({
  fileType,
  rawDocs,
  splitterSettings,
  parsedWithDocling = false,
}: SplitTextParams) => {
  try {
    // Docling always outputs Markdown regardless of input format, so
    // use the heading-aware markdown splitter for all Docling output.
    if (parsedWithDocling) {
      const chunks = splitMarkdownDocuments(rawDocs, {
        chunkSize: splitterSettings.chunkSize,
        chunkOverlap: splitterSettings.chunkOverlap,
        keepSeparator: true,
      });

      // Docling knows which page each element came from; the markdown it
      // produces does not. This is the only point where both the original
      // string and the chunks cut from it are in scope, so it is where a
      // chunk learns its page.
      const source = rawDocs[0];
      const anchors = source?.metadata?.doclingPageAnchors as
        PageAnchor[] | undefined;

      const withPages =
        anchors && anchors.length > 0
          ? attachSourcePages(chunks, source.pageContent, anchors)
          : chunks;

      // The tables, as chunks of their own. Present on the metadata only when
      // the excision actually ran, so this is never a second copy of figures
      // the prose still holds — `loadDocling` withholds the key after a
      // refusal, and emitting alongside the prose is the duplication ADR-15's
      // exact-string dedupe would not collapse.
      const tables = source?.metadata?.doclingTables as
        DoclingTable[] | undefined;
      if (!tables || tables.length === 0) {
        return withoutTransport(withPages);
      }

      const tableChunks = tables.flatMap((table, index) =>
        buildTableChunks(table, index, {
          budget: splitterSettings.chunkSize,
          sectionPath: table.sectionPath,
        }),
      );

      // After the prose, not interleaved. Order within a file is what
      // `chunk_index`, `previous_chunk_id` and `next_chunk_id` describe, and a
      // table chunk has no position in the prose to be interleaved at — its
      // place is marked by the placeholder the excision left behind.
      return [...withoutTransport(withPages), ...tableChunks];
    }

    switch (fileType) {
      case FileType.MARKDOWN:
        return splitMarkdownDocuments(rawDocs, {
          chunkSize: splitterSettings.chunkSize,
          chunkOverlap: splitterSettings.chunkOverlap,
          keepSeparator: true,
        });

      case FileType.CSV:
      case FileType.XLSX:
        // Both CSV files and per-sheet XLSX documents share the same
        // row-group strategy: header row repeated at the top of every chunk.
        // For XLSX, sheet_name is already set in metadata by the loader
        // and flows through prepareMetadata into the Qdrant payload.
        return splitCsvDocuments(rawDocs, {
          chunkSize: splitterSettings.chunkSize,
        });

      case FileType.DOCX:
        return splitDocxDocuments(rawDocs, {
          chunkSize: splitterSettings.chunkSize,
          chunkOverlap: splitterSettings.chunkOverlap,
        });

      case FileType.PDF:
        // Claude's structured PDF extraction (ADR-18) returns one Document
        // per section, each with sectionPath metadata. The splitter here
        // just enforces the chunk budget: short sections pass through,
        // long sections get recursively split with sectionPath preserved.
        // Legacy flat-text fallback documents (no sectionPath) are handled
        // safely too — they just flow through the same recursive split path.
        return splitPdfDocuments(rawDocs, {
          chunkSize: splitterSettings.chunkSize,
          chunkOverlap: splitterSettings.chunkOverlap,
        });

      case FileType.PPTX:
        // PPTX is only supported via Docling (handled by the early return
        // above when parsedWithDocling is true). If we reach here it means
        // Docling failed and there's no legacy loader — use markdown splitter
        // as a best-effort fallback.
        return splitMarkdownDocuments(rawDocs, {
          chunkSize: splitterSettings.chunkSize,
          chunkOverlap: splitterSettings.chunkOverlap,
          keepSeparator: true,
        });

      case FileType.SRT:
        // SRT is already chunked by the loader's LLM-based semantic
        // segmentation (parse-srt-to-segments). Each document already
        // carries timestamp_start_ms / timestamp_end_ms metadata where
        // substring matching succeeded. Pass through unchanged.
        return rawDocs;

      default:
        return splitDocuments(rawDocs, {
          chunkSize: splitterSettings.chunkSize,
          chunkOverlap: splitterSettings.chunkOverlap,
          keepSeparator: true,
        });
    }
  } catch (error) {
    logger.error(
      { err: error, fileType, docsCount: rawDocs.length },
      'Failed to split documents',
    );
    throw error;
  }
};
