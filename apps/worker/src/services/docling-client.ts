import { readFile } from 'fs/promises';

import { type SourceRegion } from '@ragenai/rag-core';

import { DOCLING_URL } from '../consts';
import { logger } from './logger';

type DoclingConvertResponse = {
  document: {
    md_content: string | null;
    /**
     * The structured `DoclingDocument`. Sent as a JSON string by some
     * docling-serve versions and as an object by others, so both are handled.
     */
    json_content: string | Record<string, unknown> | null;
  };
  status: 'success' | 'partial_success' | 'skipped' | 'failure';
  errors: string[];
};

/**
 * One cell of a parsed table, as `DoclingDocument` reports it.
 *
 * `column_header` is what makes a row-group strategy possible without a
 * heuristic: the parser states which row holds the column names instead of
 * leaving us to guess from the first one. Confirmed present on Docling's
 * HTML, markdown and spreadsheet backends — see
 * `__tests__/docling-table-contract.test.ts`, which pins it.
 */
export type DoclingTableCell = {
  text: string;
  columnHeader: boolean;
  /** > 1 on a merged cell. A repeated header flattens these and loses some meaning. */
  rowSpan: number;
  colSpan: number;
  startRow: number;
  startCol: number;
};

/** A table Docling parsed out of the document, alongside the markdown. */
export type DoclingTable = {
  /** Its own `#/tables/N` reference, kept so a placeholder can be traced back. */
  selfRef: string;
  numRows: number;
  numCols: number;
  cells: DoclingTableCell[];
  /** Docling's own caption, when it found one. Often absent. */
  caption?: string;
  /**
   * The page this table sits on, 1-based.
   *
   * Read straight from `tables[i].prov[0].page_no`, which uses no shared
   * cursor and therefore does not touch the text anchor walk's invariant.
   * Absent for a source with no pages at all — a markdown document reports
   * `prov: []`.
   */
  page?: number;
};

/**
 * How many elements of each Docling label the document contains.
 *
 * Carried for the table work's follow-ups rather than for itself: dropping
 * `page_header` and `page_footer` before they reach a chunk is a second change
 * to chunk content and owes its own measurement, so the labels are plumbed and
 * nothing acts on them. A count rather than a per-element list because nothing
 * yet needs to know *which* element.
 */
export type DoclingElementLabels = Record<string, number>;

/**
 * Where one text element starts in the markdown, and where it sits on the page.
 *
 * One per *located* element, not one per page. The page lookup that reads
 * these is unaffected by the density — see `buildTextElementAnchors` for why
 * that is a property of the walk and not a coincidence.
 */
export type TextElementAnchor = {
  /** Character offset into the markdown. */
  offset: number;
  /** 1-based page the text at that offset came from. */
  page: number;
  /**
   * The element's box. Absent — never zeroed — when the parser gave no usable
   * one: a missing or zero `pages[n].size`, a non-finite coordinate, or a box
   * that normalises to nothing. The anchor survives without it.
   */
  region?: SourceRegion;
};

/**
 * The anchor shape `attachSourcePages` needs, which is a subset of the above.
 * Kept as a name because the splitter only ever asked for offset and page.
 */
export type PageAnchor = {
  /** Character offset into the markdown. */
  offset: number;
  /** 1-based page the text at that offset came from. */
  page: number;
};

export type DoclingConversion = {
  markdown: string;
  /**
   * How many pages the document actually has, straight from the parser.
   *
   * `null` when the format has no such thing — Markdown, plain text and CSV
   * are not paginated, and inventing a number for them would be the same
   * mistake as the char-count estimate this replaces, with more confidence
   * behind it.
   */
  pageCount: number | null;
  /**
   * Where each located text element begins in the markdown, ascending by
   * offset, with its box where the parser gave a usable one.
   *
   * Docling reports a page and a box per *element*, and the markdown is one
   * flat string, so this is the bridge: a chunk starting at offset X came from
   * the page of the last anchor at or before X, and covers the regions of the
   * anchors inside it.
   *
   * Sparse on purpose. Only text elements are anchored — see the invariants on
   * `buildTextElementAnchors` for why widening that is not a small change —
   * and an element whose text cannot be located verbatim is skipped rather
   * than guessed at. Gaps cost nothing for the page lookup: it walks backwards
   * to the last known page, which is the right answer for anything between two
   * anchors.
   *
   * Still named `pageAnchors` after it stopped being one-per-page. The name is
   * the key a completed loader activity already wrote into a running
   * workflow's history, and renaming it would strand any ingest that is
   * mid-flight across a deploy for no gain the caller can see.
   */
  pageAnchors: TextElementAnchor[];
  /**
   * The tables Docling parsed, in document order.
   *
   * Empty for a document with none, and empty whenever `json_content` could
   * not be read — the same silence as `pageAnchors`, and for the same reason:
   * the markdown is the part ingest cannot do without.
   *
   * These exist here because `loadDocling` never sees `json_content` and the
   * splitter runs two modules further on. Widening this return type is
   * necessary and not sufficient — the loader puts them on `doc.metadata` and
   * the splitter reads them back off, following the channel `pageAnchors`
   * already uses.
   */
  tables: DoclingTable[];
  /** How many elements carry each label. Plumbed; nothing reads it yet. */
  elementLabels: DoclingElementLabels;
};

/** Docling's box: named sides in absolute points, plus the origin they mean. */
type DoclingBbox = {
  l: number;
  t: number;
  r: number;
  b: number;
  coord_origin?: string;
};

/**
 * How many decimals a normalised coordinate keeps.
 *
 * Four is ~0.06pt on a 612pt page — far finer than a highlight can show — and
 * it is what keeps a region to roughly forty bytes instead of a hundred and
 * twenty of float tail.
 */
const REGION_PRECISION = 4;

function round(value: number): number {
  const factor = 10 ** REGION_PRECISION;
  return Math.round(value * factor) / factor;
}

/**
 * Turns one Docling box into a top-left-origin fraction of its page.
 *
 * Returns undefined for anything unusable rather than a zeroed box: absence is
 * what the whole feature reads as "no highlight here", and a `{0,0,0,0}`
 * rectangle would be a claim about the top-left corner.
 */
function toRegion(
  page: number,
  bbox: unknown,
  pageSize: { width: number; height: number } | null,
): SourceRegion | undefined {
  if (!pageSize || !(pageSize.width > 0) || !(pageSize.height > 0)) {
    return undefined;
  }
  const box = bbox as DoclingBbox | undefined;
  if (!box) {
    return undefined;
  }
  const { l, t, r, b } = box;
  if (![l, t, r, b].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return undefined;
  }

  const { width, height } = pageSize;
  // The flag is read, never assumed. Under BOTTOMLEFT, `t` is the *higher*
  // edge and therefore the smaller distance from the top; assuming the wrong
  // origin flips every rectangle to the other end of the page.
  const topLeft = box.coord_origin === 'TOPLEFT';
  const top = topLeft ? t : height - t;
  const rawHeight = topLeft ? b - t : t - b;
  const rawWidth = r - l;
  if (!(rawWidth > 0) || !(rawHeight > 0)) {
    return undefined;
  }

  // Clamped because the field's contract says 0–1 and an OCR box can overrun
  // the page by a fraction of a point. A box that overruns by more than that
  // has already been rejected above by its sign.
  const x = Math.min(Math.max(l / width, 0), 1);
  const y = Math.min(Math.max(top / height, 0), 1);
  return {
    page,
    x: round(x),
    y: round(y),
    w: round(Math.min(rawWidth / width, 1 - x)),
    h: round(Math.min(rawHeight / height, 1 - y)),
  };
}

/** `pages` is keyed by page number as a string. */
function readPageSizes(
  parsed: unknown,
): Map<number, { width: number; height: number }> {
  const sizes = new Map<number, { width: number; height: number }>();
  const pages = (parsed as { pages?: unknown } | null)?.pages;
  if (!pages || typeof pages !== 'object') {
    return sizes;
  }
  for (const [key, value] of Object.entries(pages as Record<string, unknown>)) {
    const size = (value as { size?: unknown } | null)?.size as
      { width?: unknown; height?: unknown } | undefined;
    const page = Number(key);
    if (
      Number.isInteger(page) &&
      typeof size?.width === 'number' &&
      typeof size?.height === 'number'
    ) {
      sizes.set(page, { width: size.width, height: size.height });
    }
  }
  return sizes;
}

/**
 * Locates each text element in the markdown, recording where it starts and
 * where it sits on the page.
 *
 * Sequential rather than a global search: the same sentence can occur twice in
 * a document, and the second occurrence is not where the first element lives.
 * Walking forward keeps elements in document order and makes a repeated string
 * match the copy that comes next.
 *
 * **This used to keep one anchor per page and now keeps one per element, and
 * `source_page` is unchanged by that.** The page of a chunk is the page of the
 * last anchor at or before its start. The cursor advances for every *located*
 * element — it always did, before the old one-per-page dedup — so the set of
 * located elements and their offsets do not depend on how many of them are
 * kept, and offsets ascend. For any offset, the last anchor at or before it
 * therefore lies in the same run of same-page elements as the single anchor
 * that run used to contribute, and carries the same page. That is what earns
 * this change its exemption from an ADR-20 measurement, and
 * `docling-anchor-regression.test.ts` is the test of it.
 *
 * Two invariants hold that argument up. Both are broken by edits that look
 * obvious, and neither fails loudly:
 *
 * 1. **The walk stays `texts`-only.** Folding `tables` or `pictures` into this
 *    loop adds `indexOf` calls that advance the *shared* cursor, so a later
 *    text element matches a later occurrence of its string or misses entirely.
 *    The anchor vanishes and `source_page` changes. Tables can be anchored —
 *    but only by a second pass with its own cursor, never by widening this
 *    loop.
 * 2. **An unusable box drops the region, not the element.** When the page size
 *    is missing, the element still gets its anchor and still advances the
 *    cursor. `continue`-ing here is the obvious implementation and it skips the
 *    cursor advance, with the same cascade as (1).
 */
function buildTextElementAnchors(
  markdown: string,
  jsonContent: DoclingConvertResponse['document']['json_content'],
): TextElementAnchor[] {
  const parsed = parseJsonContent(jsonContent);
  const texts = (parsed as { texts?: unknown } | null)?.texts;
  if (!Array.isArray(texts)) {
    return [];
  }
  const pageSizes = readPageSizes(parsed);

  const anchors: TextElementAnchor[] = [];
  let cursor = 0;

  for (const element of texts) {
    const text = (element as { text?: unknown })?.text;
    const prov = (element as { prov?: unknown })?.prov;
    if (typeof text !== 'string' || !Array.isArray(prov) || prov.length === 0) {
      continue;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const page = (prov[0] as { page_no?: unknown })?.page_no;
    if (typeof page !== 'number') {
      continue;
    }

    const offset = markdown.indexOf(trimmed, cursor);
    if (offset === -1) {
      // Headings carry markdown markers, tables are rebuilt, OCR can differ
      // from the extracted string. A miss is expected and harmless.
      continue;
    }
    cursor = offset + trimmed.length;

    // An element spanning a page break has several prov entries with different
    // pages and boxes. Reading prov[0] is inherited behaviour: the chunk gets
    // the first fragment's page and rectangle and none of the continuation.
    const region = toRegion(
      page,
      (prov[0] as { bbox?: unknown })?.bbox,
      pageSizes.get(page) ?? null,
    );
    // Invariant 2: the region is what may be missing, never the anchor.
    anchors.push(region ? { offset, page, region } : { offset, page });
  }

  return anchors;
}

/**
 * Reads the parsed tables out of a `DoclingDocument`.
 *
 * Renamed to camelCase at this boundary rather than downstream, because
 * everything past `convertWithDocling` is worker code with the loader
 * convention and `prepareMetadata` is the one place that goes back to
 * snake_case.
 *
 * A malformed entry is dropped rather than repaired. The table chunker refuses
 * wholesale when its candidates and its tables do not line up, so a
 * half-understood table is worse than one that was never reported.
 */
function readTables(parsed: unknown): DoclingTable[] {
  const tables = (parsed as { tables?: unknown } | null)?.tables;
  if (!Array.isArray(tables)) {
    return [];
  }

  const result: DoclingTable[] = [];
  for (const entry of tables) {
    const table = entry as {
      self_ref?: unknown;
      captions?: unknown;
      prov?: unknown;
      data?: {
        table_cells?: unknown;
        num_rows?: unknown;
        num_cols?: unknown;
      };
    } | null;
    const cellsRaw = table?.data?.table_cells;
    const numRows = table?.data?.num_rows;
    const numCols = table?.data?.num_cols;
    if (
      !Array.isArray(cellsRaw) ||
      typeof numRows !== 'number' ||
      typeof numCols !== 'number' ||
      numRows < 1 ||
      numCols < 1
    ) {
      continue;
    }

    const cells: DoclingTableCell[] = [];
    for (const cellRaw of cellsRaw) {
      const cell = cellRaw as {
        text?: unknown;
        column_header?: unknown;
        row_span?: unknown;
        col_span?: unknown;
        start_row_offset_idx?: unknown;
        start_col_offset_idx?: unknown;
      } | null;
      if (
        typeof cell?.text !== 'string' ||
        typeof cell.start_row_offset_idx !== 'number' ||
        typeof cell.start_col_offset_idx !== 'number'
      ) {
        continue;
      }
      cells.push({
        text: cell.text,
        columnHeader: cell.column_header === true,
        rowSpan: typeof cell.row_span === 'number' ? cell.row_span : 1,
        colSpan: typeof cell.col_span === 'number' ? cell.col_span : 1,
        startRow: cell.start_row_offset_idx,
        startCol: cell.start_col_offset_idx,
      });
    }
    if (cells.length === 0) {
      continue;
    }

    // Docling's own caption, when it found one. Both backends the corpus uses
    // report `captions: []`, so the placeholder needs its ordinal fallback.
    const captions = Array.isArray(table?.captions) ? table.captions : [];
    const caption = captions
      .map((c) => (c as { text?: unknown })?.text)
      .find(
        (text): text is string => typeof text === 'string' && text.length > 0,
      );

    const prov = Array.isArray(table?.prov) ? table.prov : [];
    const page = (prov[0] as { page_no?: unknown } | undefined)?.page_no;

    result.push({
      selfRef:
        typeof table?.self_ref === 'string'
          ? table.self_ref
          : `#/tables/${result.length}`,
      numRows,
      numCols,
      cells,
      ...(caption !== undefined ? { caption } : {}),
      ...(typeof page === 'number' ? { page } : {}),
    });
  }

  return result;
}

/** Counts elements per Docling label, across texts, tables and pictures. */
function readElementLabels(parsed: unknown): DoclingElementLabels {
  const labels: DoclingElementLabels = {};
  for (const key of ['texts', 'tables', 'pictures'] as const) {
    const elements = (parsed as Record<string, unknown> | null)?.[key];
    if (!Array.isArray(elements)) {
      continue;
    }
    for (const element of elements) {
      const label = (element as { label?: unknown })?.label;
      if (typeof label === 'string' && label.length > 0) {
        labels[label] = (labels[label] ?? 0) + 1;
      }
    }
  }
  return labels;
}

/**
 * Reads the page count out of a `DoclingDocument`.
 *
 * `pages` is a map keyed by page number, so its size is the count. Returns
 * null rather than 0 or 1 when the key is missing: "this format has no pages"
 * and "this document has one page" are different answers, and the caller
 * chooses a fallback only for the first.
 */
function parseJsonContent(
  jsonContent: DoclingConvertResponse['document']['json_content'],
): unknown {
  if (!jsonContent) {
    return null;
  }
  if (typeof jsonContent !== 'string') {
    return jsonContent;
  }
  try {
    return JSON.parse(jsonContent);
  } catch {
    // A malformed body is not worth failing an otherwise good conversion
    // for — the markdown is the part ingest cannot do without.
    return null;
  }
}

function readPageCount(
  jsonContent: DoclingConvertResponse['document']['json_content'],
): number | null {
  const parsed = parseJsonContent(jsonContent);
  const pages = (parsed as { pages?: unknown } | null)?.pages;
  if (!pages || typeof pages !== 'object') {
    return null;
  }
  const count = Object.keys(pages).length;
  return count > 0 ? count : null;
}

type DoclingOptions = {
  /** Output formats to request. Defaults to markdown only. */
  toFormats?: string[];
  /** Enable OCR. Defaults to true. */
  doOcr?: boolean;
  /** Table extraction mode. Defaults to 'accurate'. */
  tableMode?: 'fast' | 'accurate';
  /** Image export mode in markdown. Defaults to 'placeholder'. */
  imageExportMode?: 'placeholder' | 'embedded' | 'referenced';
};

/**
 * Converts a local file via the docling-serve REST API.
 *
 * Uses the `/v1/convert/source` endpoint with base64-encoded file content.
 * Returns the Markdown and the real page count, throws on failure.
 *
 * **Why `json` is requested alongside `md`.** The structured document is where
 * the page count lives, and it is the only place: the markdown is one flat
 * string with no pagination in it. Before this, PDFs parsed by Docling had
 * their page count guessed as `ceil(chars / 3000)` — see the comment this
 * replaced in `parse-and-embed.ts` — and that number feeds usage limits.
 *
 * It is not free: the JSON runs several times the size of the markdown (7.8x
 * on the smallest fixture here). That is worth paying on a Temporal ingest
 * that already runs an LLM over the document, and it is paid once — the same
 * response carries the per-element `prov[].page_no` that a real `source_page`
 * per chunk needs.
 */
export const convertWithDocling = async (
  filePath: string,
  fileName: string,
  options: DoclingOptions = {},
): Promise<DoclingConversion> => {
  const {
    toFormats = ['md', 'json'],
    doOcr = true,
    tableMode = 'accurate',
    imageExportMode = 'placeholder',
  } = options;

  const fileBuffer = await readFile(filePath);
  const base64String = fileBuffer.toString('base64');

  const url = `${DOCLING_URL}/v1/convert/source`;

  logger.info(
    { fileName, url, doOcr, tableMode },
    'Sending file to Docling for conversion',
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      options: {
        to_formats: toFormats,
        do_ocr: doOcr,
        table_mode: tableMode,
        image_export_mode: imageExportMode,
        do_table_structure: true,
      },
      sources: [
        {
          kind: 'file',
          base64_string: base64String,
          filename: fileName,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(
      `Docling conversion failed (HTTP ${response.status}): ${errorText}`,
    );
  }

  const result = (await response.json()) as DoclingConvertResponse;

  if (result.status === 'failure' || result.status === 'skipped') {
    throw new Error(
      `Docling conversion ${result.status}: ${result.errors?.join(', ') || 'unknown error'}`,
    );
  }

  if (result.status === 'partial_success') {
    logger.warn(
      { fileName, errors: result.errors },
      'Docling conversion partially succeeded — some content may be missing',
    );
  }

  const markdown = result.document?.md_content;

  if (!markdown || markdown.trim().length === 0) {
    throw new Error('Docling returned empty markdown content');
  }

  const pageCount = readPageCount(result.document?.json_content);
  const pageAnchors = buildTextElementAnchors(
    markdown,
    result.document?.json_content,
  );
  const parsed = parseJsonContent(result.document?.json_content);
  const tables = readTables(parsed);
  const elementLabels = readElementLabels(parsed);

  logger.info(
    {
      fileName,
      status: result.status,
      markdownLength: markdown.length,
      pageCount,
      pageAnchors: pageAnchors.length,
      // How many of those carry a box, so a parser change that stops
      // reporting geometry is visible in the ingest log rather than only as
      // an overlay that quietly stopped appearing.
      anchorsWithRegion: pageAnchors.filter((a) => a.region !== undefined)
        .length,
      tables: tables.length,
    },
    'Docling conversion completed',
  );

  return { markdown, pageCount, pageAnchors, tables, elementLabels };
};

/**
 * Health check for docling-serve. Returns true if the service is reachable
 * and ready.
 */
export const isDoclingAvailable = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${DOCLING_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
};
