import { prepareMetadata } from '../prepare-metadata';
import { FileType } from '../../../types/UserFile';

const baseFileRecord = {
  id: 'file-1',
  fileName: 'doc.md',
  organizationId: 'org-1',
  projectId: null,
};

const splitterSettings = { chunkSize: 1000, chunkOverlap: 100 };

describe('prepareMetadata — language passthrough', () => {
  it('spreads fileRecord.language into every chunk when present', async () => {
    const docs = [
      { pageContent: 'first chunk', metadata: {} },
      { pageContent: 'second chunk', metadata: {} },
    ];

    const result = await prepareMetadata({
      docs,
      fileRecord: { ...baseFileRecord, language: 'eng' },
      fileType: FileType.MARKDOWN,
      splitterSettings,
    });

    expect(result).toHaveLength(2);
    for (const doc of result) {
      expect(doc.metadata.language).toBe('eng');
    }
  });

  it('omits the language key entirely when fileRecord.language is null', async () => {
    const docs = [{ pageContent: 'a chunk', metadata: {} }];

    const result = await prepareMetadata({
      docs,
      fileRecord: { ...baseFileRecord, language: null },
      fileType: FileType.MARKDOWN,
      splitterSettings,
    });

    expect(result[0].metadata.language).toBeUndefined();
    expect('language' in result[0].metadata).toBe(false);
  });

  it('omits the language key when fileRecord.language is not provided at all', async () => {
    const docs = [{ pageContent: 'a chunk', metadata: {} }];

    const result = await prepareMetadata({
      docs,
      fileRecord: baseFileRecord,
      fileType: FileType.MARKDOWN,
      splitterSettings,
    });

    expect('language' in result[0].metadata).toBe(false);
  });
});

describe('prepareMetadata — source regions', () => {
  const regions = [
    { page: 1, x: 0.027, y: 0.025, w: 0.941, h: 0.045 },
    { page: 1, x: 0.05, y: 0.12, w: 0.9, h: 0.06 },
  ];

  it('maps camelCase sourceRegions onto the snake_case payload key', async () => {
    // prepareMetadata is the boundary between the loaders' camelCase
    // intermediate metadata and the shape that lands in Qdrant. A field that
    // is not mapped here never reaches the vector store, however carefully the
    // splitter computed it.
    const result = await prepareMetadata({
      docs: [{ pageContent: 'a chunk', metadata: { sourceRegions: regions } }],
      fileRecord: baseFileRecord,
      fileType: FileType.PDF,
      splitterSettings,
    });

    expect(result[0].metadata.source_regions).toEqual(regions);
  });

  it('omits the key when the splitter produced no regions', async () => {
    const result = await prepareMetadata({
      docs: [{ pageContent: 'a chunk', metadata: {} }],
      fileRecord: baseFileRecord,
      fileType: FileType.PDF,
      splitterSettings,
    });

    expect('source_regions' in result[0].metadata).toBe(false);
  });

  it('omits the key rather than writing an empty array', async () => {
    // Absence is the discriminator the overlay reads. An empty array would say
    // "this chunk covers no part of the page".
    const result = await prepareMetadata({
      docs: [{ pageContent: 'a chunk', metadata: { sourceRegions: [] } }],
      fileRecord: baseFileRecord,
      fileType: FileType.PDF,
      splitterSettings,
    });

    expect('source_regions' in result[0].metadata).toBe(false);
  });

  it('does not invent regions for a loader that has none', async () => {
    // Every non-Docling loader and every unpaginated format. A re-index is
    // what upgrades a document, not a default.
    const result = await prepareMetadata({
      docs: [{ pageContent: 'a chunk', metadata: { sourcePage: 3 } }],
      fileRecord: baseFileRecord,
      fileType: FileType.TEXT,
      splitterSettings,
    });

    expect(result[0].metadata.source_page).toBe(3);
    expect('source_regions' in result[0].metadata).toBe(false);
  });
});
