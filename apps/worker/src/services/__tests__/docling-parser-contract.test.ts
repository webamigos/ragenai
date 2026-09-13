/**
 * What docling-serve actually sends, pinned.
 *
 * Element-level provenance is built on fields nothing in this repo asserted:
 * `prov[0].bbox` and its `coord_origin`, and `pages[n].size`. They are read
 * out of an HTTP response, so a Docling upgrade can rename or drop one and
 * every downstream test — which feeds hand-written JSON — keeps passing while
 * ingest silently stops producing boxes.
 *
 * The fixture beside this file is a real `/v1/convert/source` response from
 * `docling-serve-cpu:v1.32.0` for
 * `apps/web/evals/e2e-rag/fixtures/regulamin-wilczy-mlyn.pdf`, recorded
 * verbatim apart from `processing_time`, `timings` and `confidence`, which
 * vary per run and would pin nothing.
 *
 * No production code is exercised here on purpose: this asserts the contract
 * the implementation is allowed to assume, and it has to be able to fail
 * before that implementation exists.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

type Bbox = {
  l: number;
  t: number;
  r: number;
  b: number;
  coord_origin: string;
};
type Prov = { page_no: number; bbox: Bbox; charspan: [number, number] };
type TextElement = {
  self_ref: string;
  label: string;
  text: string;
  prov: Prov[];
};
type Page = {
  page_no: number;
  size: { width: number; height: number };
} & Record<string, unknown>;
type DoclingDocument = {
  schema_name: string;
  version: string;
  texts: TextElement[];
  tables: unknown[];
  pictures: unknown[];
  pages: Record<string, Page>;
};

const response = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/docling-regulamin-wilczy-mlyn.json'),
    'utf8',
  ),
) as {
  status: string;
  errors: string[];
  document: { md_content: string; json_content: DoclingDocument };
};

const doc = response.document.json_content;

describe('the docling-serve response this spec is built on', () => {
  it('converts successfully and returns markdown alongside the structured document', () => {
    expect(response.status).toBe('success');
    expect(response.errors).toEqual([]);
    expect(typeof response.document.md_content).toBe('string');
    expect(response.document.md_content.length).toBeGreaterThan(0);
    // Sent as an object by this version. `parseJsonContent` handles a string
    // too, and that branch has its own test — this pins which one we saw.
    expect(typeof response.document.json_content).toBe('object');
  });

  it('is the DoclingDocument schema the field names below come from', () => {
    expect(doc.schema_name).toBe('DoclingDocument');
    expect(doc.version).toBe('1.10.0');
  });

  it('gives every text element a self_ref and a label', () => {
    expect(doc.texts.length).toBeGreaterThan(0);
    for (const element of doc.texts) {
      expect(typeof element.self_ref).toBe('string');
      expect(element.self_ref).toMatch(/^#\/texts\/\d+$/);
      expect(typeof element.label).toBe('string');
      expect(typeof element.text).toBe('string');
    }
  });

  it('gives every text element a box with a stated coordinate origin', () => {
    for (const element of doc.texts) {
      expect(element.prov.length).toBeGreaterThan(0);
      const [first] = element.prov;
      expect(typeof first.page_no).toBe('number');
      // Named sides, not x/y/w/h, and not a tuple. The conversion in
      // `convertWithDocling` reads these four keys by name.
      expect(Object.keys(first.bbox).sort()).toEqual([
        'b',
        'coord_origin',
        'l',
        'r',
        't',
      ]);
      for (const side of ['l', 't', 'r', 'b'] as const) {
        expect(typeof first.bbox[side]).toBe('number');
      }
      // The flag the worker reads instead of assuming. Both values are
      // handled; this fixture happens to be bottom-left.
      expect(['BOTTOMLEFT', 'TOPLEFT']).toContain(first.bbox.coord_origin);
    }
  });

  it('reports points from the bottom-left on this document', () => {
    const [first] = doc.texts[0].prov;
    expect(first.bbox.coord_origin).toBe('BOTTOMLEFT');
    // t is *higher on the page* than b under this origin. Assuming top-left
    // here would produce a negative height and a box at the wrong end.
    expect(first.bbox.t).toBeGreaterThan(first.bbox.b);
    expect(first.bbox).toMatchObject({ l: 16.6, t: 772.38, b: 737.01 });
  });

  it('gives every page a size, which is what makes a box a fraction', () => {
    const pages = Object.values(doc.pages);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(typeof page.size.width).toBe('number');
      expect(typeof page.size.height).toBe('number');
      expect(page.size.width).toBeGreaterThan(0);
      expect(page.size.height).toBeGreaterThan(0);
    }
    expect(doc.pages['1'].size).toEqual({ width: 612, height: 792 });
  });

  it('is keyed by page number as a string, which is what the page count counts', () => {
    for (const [key, page] of Object.entries(doc.pages)) {
      expect(key).toBe(String(page.page_no));
    }
  });

  it('states no page rotation', () => {
    // Boxes are placed against an unrotated frame because there is nothing
    // else to place them against. If a Docling upgrade starts reporting
    // rotation, this fails and the conversion has to account for it rather
    // than quietly drawing rectangles in the wrong place.
    for (const page of Object.values(doc.pages)) {
      expect(page).not.toHaveProperty('angle');
      expect(page).not.toHaveProperty('rotation');
      expect(page).not.toHaveProperty('orientation');
    }
  });

  it('puts tables and pictures outside `texts`', () => {
    // The anchor walk stays texts-only, and this is why that is a meaningful
    // restriction rather than a tautology: the other element kinds are real
    // arrays that an implementer could fold into the same loop.
    expect(Array.isArray(doc.tables)).toBe(true);
    expect(Array.isArray(doc.pictures)).toBe(true);
    const labels = new Set(doc.texts.map((element) => element.label));
    expect([...labels].sort()).toEqual(['list_item', 'text']);
  });
});
