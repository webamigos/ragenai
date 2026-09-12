import {
  attachSourcePages,
  type PageAnchor,
} from '../../services/text-splitters/source-pages';
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
      return anchors && anchors.length > 0
        ? attachSourcePages(chunks, source.pageContent, anchors)
        : chunks;
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
