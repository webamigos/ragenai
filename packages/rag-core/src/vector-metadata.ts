/**
 * Where a piece of a document sits on its page, as top-left-origin fractions
 * of the page box, 0–1.
 *
 * Normalised by the worker at the parser boundary rather than by whatever
 * draws it. Docling reports absolute points from a **bottom-left** origin and
 * pdf.js renders a canvas with a top-left origin at a user-chosen scale, so
 * converting in the component means every consumer needs the page size, the
 * origin flag and the zoom, and gets one of them wrong. A fraction is correct
 * at every zoom with no further arithmetic.
 */
export type SourceRegion = {
  /** 1-based page. */
  page: number;
  /** Distance from the left edge, as a fraction of page width. */
  x: number;
  /** Distance from the top edge, as a fraction of page height. */
  y: number;
  /** Width, as a fraction of page width. */
  w: number;
  /** Height, as a fraction of page height. */
  h: number;
};

/**
 * How many regions one chunk may carry.
 *
 * A highlight spanning most of a page tells the reader nothing, so there is no
 * point paying payload bytes past this.
 */
export const MAX_SOURCE_REGIONS = 32;

/**
 * The Qdrant chunk payload, shared by apps/web, apps/api and apps/worker.
 *
 * The worker writes this shape; the app and the api read it. It lived as two
 * hand-kept copies — `apps/worker/src/services/llm/types/vector-store.ts` and
 * `apps/web/src/app/lib/types/types.ts` — and they drifted in **both**
 * directions: the worker copy had grown eleven fields the web copy lacked, the
 * web copy had `accessible_by`, which the chatbot metadata filter reads, and
 * two fields the worker actually writes (`pii_mode`, `content_original`) were
 * in neither.
 *
 * ADR-33 is about exactly this pattern, and says of the architecture test that
 * was the earlier answer to it that "the tests were not enough, because they
 * only covered what someone thought to compare". So the type moved here rather
 * than gaining a guard. Both former homes re-export it, so no import churn was
 * needed to land the move.
 *
 * Every field that differed between the copies is optional, which is what
 * makes the union safe in both directions: a reader that never knew about a
 * field still compiles, and a writer that omits one still satisfies the type.
 */
export type VectorStoreDocumentMetadata = {
  file_name: string;
  /**
   * The chunk's 1-based ordinal within its file.
   *
   * Held the name `page_number` until gap 3 of the design-system-v2 spec, and
   * the design read it as a page. It never was one:
   * a twelve-page PDF split into forty chunks yielded "page 37". The rename is
   * the fix — a field whose name states what it holds cannot be rendered under
   * the wrong word by the next person who finds it.
   *
   * The real page is `source_page`, written only when the parser knows one.
   * Chunks already in Qdrant keep an inert `page_number`; nothing reads it, and
   * a re-index is what upgrades a document.
   */
  chunk_index: number;
  /**
   * The real page this chunk came from, 1-based.
   *
   * Absent when the parser could not say — every legacy loader, every
   * unpaginated format, and any chunk Docling's elements could not be matched
   * to. **Absence is the discriminator**: the UI shows "· page {n}" only when
   * this is present, so a chunk ingested before the field existed cannot be
   * labelled by a rule it predates. Do not default it.
   */
  source_page?: number;
  /**
   * Where on the page this chunk's text sits.
   *
   * One entry per Docling *text* element the chunk covers, in reading order.
   * Tables and pictures are not represented — the anchor walk that produces
   * these is deliberately texts-only.
   *
   * Absent — never empty — when the parser gave no usable box: every
   * non-Docling loader, every unpaginated format, and any element whose text
   * could not be located in the markdown. **Absence is the discriminator**,
   * the same rule as `source_page`: the overlay renders only where this is
   * present, so a chunk ingested before the field existed cannot be drawn by a
   * rule it predates.
   *
   * Capped at {@link MAX_SOURCE_REGIONS}.
   */
  source_regions?: SourceRegion[];
  created_at: string;
  id: string;
  organization_id: string;
  file_id: string;
  project_id: string | null;
  source_type: string;
  chunk_size: number;
  chunk_overlap: number;
  word_count: number;
  previous_chunk_id: number;
  next_chunk_id: number;
  status: 'active' | 'archived';
  embedding_model: string;
  total_chunks: number;
  /**
   * What kind of chunk this is, when it is not ordinary prose.
   *
   * `'summary'` is ADR-16's synthetic per-document chunk. `'table'` is a table
   * Docling parsed, lifted out of the markdown into a chunk that repeats its
   * own header (ADR-43). Absent on everything else, which is most chunks.
   *
   * Nothing branches on `'table'` at read time: the only reader compares
   * against `'summary'`, so widening the union changes no behaviour beyond
   * making the value describable.
   */
  chunk_type?: 'summary' | 'table';
  pii_policy?: 'NONE' | 'TOXIC_ONLY' | 'STRICT';
  pii_alert?: boolean;
  pii_detected_entities?: string[];
  pii_masked_entities?: string[];
  /**
   * How PII was handled for this chunk.
   *
   * `'dual_content'` means `pageContent` is the masked text and
   * `content_original` holds the encrypted original, which the chat path
   * decrypts for a reader who is allowed to see it. Written by the worker and
   * read by `decode-dual-content-chunks.ts`, and declared in neither of the
   * two former copies of this type — the drift this move exists to end.
   */
  pii_mode?: 'dual_content';
  /** The pre-masking text, encrypted. Only alongside `pii_mode`. */
  content_original?: string;
  section_path?: string;
  sheet_name?: string;
  timestamp_start_ms?: number;
  timestamp_end_ms?: number;
  /** ISO 639-3 code detected by franc at ingest time. One value per document, shared by every chunk. */
  language?: string;
  /**
   * User ids allowed to retrieve this chunk, for the chatbot's metadata
   * filter. Only the web ingest path writes it.
   */
  accessible_by?: string[];
};

export type VectorStoreMetadataFilter = Partial<VectorStoreDocumentMetadata>;
