import { type SourceRegion } from '@ragenai/rag-core';

import { type Document } from '../../types/Document';
import { type VectorStoreDocumentMetadata } from '../../services/llm/types/vector-store';
import { type FileType } from '../../types/UserFile';
import { type SplitterSettings } from '../../utils/splitters';
import { EMBEDDINGS_MODEL } from '../../consts';

type FileRecordInfo = {
  id: string;
  fileName: string;
  organizationId: string;
  projectId: string | null;
  piiPolicy?: 'NONE' | 'TOXIC_ONLY' | 'STRICT';
  /** ISO 639-3 code detected by franc. One value per document, spread into every chunk's metadata. */
  language?: string | null;
};

type Params = {
  docs: Document[];
  fileRecord: FileRecordInfo;
  fileType: FileType;
  splitterSettings: SplitterSettings;
};

export const prepareMetadata = async ({
  docs,
  fileRecord,
  fileType,
  splitterSettings,
}: Params) => {
  return await Promise.all(
    docs.map(async (doc, index) => {
      const text = doc.pageContent;
      // Preserve type-specific enrichment from the loaders/splitters:
      //   - ADR-16 summary chunk marker (chunk_type)
      //   - ADR-17 type-specific chunking metadata (sectionPath from DOCX,
      //     sheetName from XLSX, timestampStartMs/timestampEndMs from SRT)
      //
      // Intermediate metadata on the Document objects uses the camelCase
      // loader convention (matches fileName/fileType/source adjacent to
      // these fields). prepareMetadata is the boundary that maps them to
      // the snake_case VectorStoreDocumentMetadata shape that lands in
      // Qdrant. All other incoming metadata keys are intentionally dropped —
      // prepareMetadata owns the canonical vector-store metadata shape.
      const incoming = doc.metadata as
        | {
            chunk_type?: 'summary';
            sectionPath?: string;
            sheetName?: string;
            timestampStartMs?: number;
            timestampEndMs?: number;
            pii_alert?: boolean;
            pii_detected_entities?: string[];
            pii_masked_entities?: string[];
            pii_mode?: 'dual_content';
            content_original?: string;
            sourcePage?: number;
            sourceRegions?: SourceRegion[];
          }
        | undefined;

      const metadata: VectorStoreDocumentMetadata = {
        file_name: fileRecord.fileName,
        file_id: fileRecord.id,
        chunk_index: index + 1,
        // Only when the parser actually knew a page. Its absence is what
        // makes every chunk ingested before gap 3 safe: the UI renders
        // "· page {n}" when this is present and nothing when it is not, so an
        // old chunk cannot be mislabelled by a rule it predates.
        ...(typeof incoming?.sourcePage === 'number'
          ? { source_page: incoming.sourcePage }
          : {}),
        // Same rule, one level down: the overlay draws only where this is
        // present, so an empty array would be a claim that the chunk covers no
        // part of the page rather than "the parser gave no box".
        ...(incoming?.sourceRegions && incoming.sourceRegions.length > 0
          ? { source_regions: incoming.sourceRegions }
          : {}),
        created_at: new Date().toISOString().split('T')[0],
        id: `${fileRecord.id}-${index}`,
        organization_id: fileRecord.organizationId,
        project_id: fileRecord.projectId,
        source_type: fileType,
        chunk_size: splitterSettings.chunkSize,
        chunk_overlap: splitterSettings.chunkOverlap,
        total_chunks: docs.length,
        word_count: text.split(/\s+/).length,
        // These store zero-based indices within this file's chunk array, not
        // composite IDs like the `id` field above. Named _id for historical
        // reasons (Qdrant metadata schema shared with apps/web).
        previous_chunk_id: index > 0 ? index - 1 : -1,
        next_chunk_id: index < docs.length - 1 ? index + 1 : -1,
        status: 'active',
        embedding_model: EMBEDDINGS_MODEL,
        pii_policy: fileRecord.piiPolicy ?? 'TOXIC_ONLY',
        ...(fileRecord.language ? { language: fileRecord.language } : {}),
        ...(incoming?.pii_alert ? { pii_alert: true } : {}),
        ...(incoming?.pii_detected_entities
          ? { pii_detected_entities: incoming.pii_detected_entities }
          : {}),
        ...(incoming?.pii_masked_entities
          ? { pii_masked_entities: incoming.pii_masked_entities }
          : {}),
        ...(incoming?.chunk_type ? { chunk_type: incoming.chunk_type } : {}),
        ...(incoming?.sectionPath
          ? { section_path: incoming.sectionPath }
          : {}),
        ...(incoming?.sheetName ? { sheet_name: incoming.sheetName } : {}),
        ...(incoming?.timestampStartMs !== undefined
          ? { timestamp_start_ms: incoming.timestampStartMs }
          : {}),
        ...(incoming?.timestampEndMs !== undefined
          ? { timestamp_end_ms: incoming.timestampEndMs }
          : {}),
        ...(incoming?.pii_mode ? { pii_mode: incoming.pii_mode } : {}),
        ...(incoming?.content_original
          ? { content_original: incoming.content_original }
          : {}),
      };

      return {
        pageContent: text,
        metadata,
        embedding: [],
      };
    }),
  );
};
