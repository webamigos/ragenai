import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Attributes, Span } from '@opentelemetry/api';

const { mockRerankDocuments, mockIsRerankingEnabled } = vi.hoisted(() => ({
  mockRerankDocuments: vi.fn(),
  mockIsRerankingEnabled: vi.fn(),
}));

vi.mock('@/libs/monitoring/with-span', () => ({
  withSpan: async <T>(
    _name: string,
    _attributes: Attributes,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> => fn({ setAttribute: () => undefined } as unknown as Span),
}));

vi.mock('@/libs/reranker', () => ({
  rerankDocuments: mockRerankDocuments,
  isRerankingEnabled: mockIsRerankingEnabled,
}));

vi.mock('@/app/lib/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock(
  '@/features/ai-usage/services/commands/create-ai-usage-command',
  () => ({ trackAiUsage: vi.fn() }),
);

import { retrieveRelevantDocumentsWithIds } from '../operations';
import type { VectorStoreClient } from '@/libs/vector-store/types';

type Chunk = { pageContent: string; metadata: Record<string, unknown> };

function storeReturning(chunks: Chunk[]): VectorStoreClient {
  return {
    similaritySearch: vi.fn(async () => chunks),
  } as unknown as VectorStoreClient;
}

const region = { page: 7, x: 0.05, y: 0.2, w: 0.9, h: 0.06 };

const chunkWith = (
  source_regions: unknown,
  extra: Record<string, unknown> = {},
): Chunk => ({
  pageContent: 'the passage the model read',
  metadata: {
    file_id: 'file-a',
    file_name: 'a.pdf',
    source_page: 7,
    source_regions,
    ...extra,
  },
});

const regionsOf = async (chunks: Chunk[]) => {
  const { sources } = await retrieveRelevantDocumentsWithIds(
    storeReturning(chunks),
    'pytanie',
  );
  return sources[0]?.sourceRegions;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsRerankingEnabled.mockReturnValue(false);
});

/**
 * Where on the page the quoted passage sits.
 *
 * The payload is schemaless and comes back as whatever some version of the
 * worker wrote, so the read is validated rather than cast. A bad entry passed
 * through would reach a viewer as `left: NaN%` — a rectangle at no position on
 * a page nothing can trace it to — which is worse than no highlight at all.
 */
describe('retrieveRelevantDocumentsWithIds — source regions', () => {
  it('takes the regions from the same chunk as the page and the quote', async () => {
    // All three describe one place in one document. A rectangle drawn from a
    // different chunk would point at the wrong paragraph under the right
    // quote.
    const { sources } = await retrieveRelevantDocumentsWithIds(
      storeReturning([
        chunkWith([region]),
        chunkWith([{ page: 9, x: 0, y: 0, w: 1, h: 1 }], { source_page: 9 }),
      ]),
      'pytanie',
    );

    expect(sources[0].sourceRegions).toEqual([region]);
    expect(sources[0].sourcePage).toBe(7);
  });

  it('leaves the field off a chunk that has none', async () => {
    // Every non-Docling loader, every unpaginated format, and every chunk
    // ingested before the field existed. A re-index is what upgrades them.
    const { sources } = await retrieveRelevantDocumentsWithIds(
      storeReturning([
        {
          pageContent: 'a1',
          metadata: { file_id: 'file-a', file_name: 'a.pdf' },
        },
      ]),
      'pytanie',
    );

    expect(sources[0]).not.toHaveProperty('sourceRegions');
  });

  it('omits the field rather than carrying an empty array through', async () => {
    expect(await regionsOf([chunkWith([])])).toBeUndefined();
  });

  it('drops an entry that is not a box', async () => {
    expect(
      await regionsOf([chunkWith([region, null, 'nonsense', 42])]),
    ).toEqual([region]);
  });

  it('drops an entry with a missing coordinate', async () => {
    expect(
      await regionsOf([chunkWith([{ page: 1, x: 0.1, y: 0.1, w: 0.5 }])]),
    ).toBeUndefined();
  });

  it('drops a coordinate that is not a fraction of the page', async () => {
    // The contract is 0–1. A value outside it is not a box drawn wrongly, it
    // is one that was never a box — most likely raw points from a writer that
    // skipped the normalisation.
    expect(
      await regionsOf([
        chunkWith([{ page: 1, x: 16.6, y: 772.38, w: 576, h: 35 }]),
      ]),
    ).toBeUndefined();
  });

  it('drops a non-finite coordinate instead of rendering NaN%', async () => {
    expect(
      await regionsOf([chunkWith([{ page: 1, x: NaN, y: 0, w: 1, h: 1 }])]),
    ).toBeUndefined();
  });

  it('drops an entry whose page is not a page number', async () => {
    expect(
      await regionsOf([chunkWith([{ page: 0, x: 0, y: 0, w: 1, h: 1 }])]),
    ).toBeUndefined();
    expect(
      await regionsOf([chunkWith([{ page: 1.5, x: 0, y: 0, w: 1, h: 1 }])]),
    ).toBeUndefined();
  });

  it('ignores a payload that is not a list at all', async () => {
    expect(await regionsOf([chunkWith({ page: 1 })])).toBeUndefined();
  });

  it('keeps the good entries beside a bad one', async () => {
    // One malformed rectangle should cost one rectangle, not the highlight.
    const second = { page: 7, x: 0.05, y: 0.4, w: 0.9, h: 0.06 };

    expect(
      await regionsOf([
        chunkWith([region, { page: 7, x: 2, y: 0, w: 1, h: 1 }, second]),
      ]),
    ).toEqual([region, second]);
  });

  it('drops a box that starts on the page but runs off it', async () => {
    // Passes every per-coordinate check — each of x, y, w, h is in 0–1 — and
    // still draws a rectangle over the edge. The worker clamps width and
    // height against the origin so it never writes one, but this reads back
    // whatever some version of it wrote.
    expect(
      await regionsOf([chunkWith([{ page: 1, x: 0.9, y: 0, w: 0.9, h: 0.1 }])]),
    ).toBeUndefined();
    expect(
      await regionsOf([
        chunkWith([{ page: 1, x: 0, y: 0.95, w: 0.1, h: 0.2 }]),
      ]),
    ).toBeUndefined();
  });

  it('keeps a box that touches the page edges', async () => {
    // 0 and 1 are legal: a full-width banner is a real element.
    const edge = { page: 1, x: 0, y: 0, w: 1, h: 1 };

    expect(await regionsOf([chunkWith([edge])])).toEqual([edge]);
  });
});
