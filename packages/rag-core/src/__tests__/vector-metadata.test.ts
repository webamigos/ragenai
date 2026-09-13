import { describe, expect, it } from 'vitest';

import { MAX_SOURCE_REGIONS } from '../index';
import type {
  SourceRegion,
  VectorStoreDocumentMetadata,
  VectorStoreMetadataFilter,
} from '../index';

/**
 * A type has no runtime surface, so what is asserted here is that the union
 * accepts what each former copy used to describe on its own.
 *
 * The value of that is the *compile*: before this move, a payload the worker
 * writes could not be typed by the web app's copy and vice versa, and nothing
 * said so. These fixtures fail the build if a field is dropped from the union
 * or if one that was optional becomes required.
 */
describe('VectorStoreDocumentMetadata', () => {
  const required = {
    file_name: 'regulamin.pdf',
    chunk_index: 1,
    created_at: '2026-09-12',
    id: 'file-1-0',
    organization_id: 'org-1',
    file_id: 'file-1',
    project_id: null,
    source_type: 'pdf',
    chunk_size: 1200,
    chunk_overlap: 200,
    word_count: 180,
    previous_chunk_id: -1,
    next_chunk_id: 1,
    status: 'active',
    embedding_model: 'bge-multilingual-gemma2',
    total_chunks: 4,
  } satisfies VectorStoreDocumentMetadata;

  it('accepts a payload with nothing optional set', () => {
    const metadata: VectorStoreDocumentMetadata = required;
    expect(metadata.project_id).toBeNull();
  });

  it('accepts every field the worker copy used to own', () => {
    const metadata: VectorStoreDocumentMetadata = {
      ...required,
      source_page: 7,
      chunk_type: 'summary',
      pii_policy: 'STRICT',
      pii_alert: true,
      pii_detected_entities: ['PERSON'],
      pii_masked_entities: ['PERSON'],
      section_path: 'Rozdział 2 > Limity',
      sheet_name: 'Zamówienia',
      timestamp_start_ms: 0,
      timestamp_end_ms: 4200,
      language: 'pol',
    };
    expect(metadata.section_path).toBe('Rozdział 2 > Limity');
  });

  it('accepts the field only the web copy used to own', () => {
    const metadata: VectorStoreDocumentMetadata = {
      ...required,
      accessible_by: ['user-1'],
    };
    expect(metadata.accessible_by).toEqual(['user-1']);
  });

  it('accepts the two fields neither copy declared but the worker writes', () => {
    // `pii_mode` / `content_original` are written by prepareMetadata and read
    // by decode-dual-content-chunks, and were absent from both hand-kept
    // copies — the drift this move exists to end.
    const metadata: VectorStoreDocumentMetadata = {
      ...required,
      pii_mode: 'dual_content',
      content_original: 'encrypted:…',
    };
    expect(metadata.pii_mode).toBe('dual_content');
  });

  it('carries where on the page a chunk sits', () => {
    const region: SourceRegion = {
      page: 7,
      x: 0.0271,
      y: 0.0248,
      w: 0.9413,
      h: 0.0447,
    };
    const metadata: VectorStoreDocumentMetadata = {
      ...required,
      source_regions: [region],
    };
    expect(metadata.source_regions).toEqual([region]);
  });

  it('caps how many regions one chunk may carry', () => {
    // A highlight covering most of a page tells the reader nothing, so past
    // this the payload bytes buy nothing either.
    expect(MAX_SOURCE_REGIONS).toBe(32);
  });

  it('filters by any subset of the payload', () => {
    const filter: VectorStoreMetadataFilter = { organization_id: 'org-1' };
    expect(filter).toEqual({ organization_id: 'org-1' });
  });
});
