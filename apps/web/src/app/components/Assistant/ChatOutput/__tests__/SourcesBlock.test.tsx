import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';

import { SourcesBlock } from '../SourcesBlock';
import messages from '@/app/messages/en.json';
import type {
  MessageRetrieval,
  RetrievalSource,
} from '@/store/assistant/assistantSlice';

const show = (
  retrieval: Partial<MessageRetrieval> = {},
  onActivate?: (source: RetrievalSource) => void,
) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SourcesBlock
        idPrefix="src-m1"
        onActivate={onActivate}
        retrieval={{
          sources: [{ fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 }],
          chunkCount: 3,
          durationMs: 120,
          citedFileIds: [],
          ...retrieval,
        }}
      />
    </NextIntlClientProvider>,
  );

const row = (name: string) =>
  screen.getByText(name).closest('li') as HTMLElement;

describe('SourcesBlock', () => {
  it('reports documents, chunks and time, because none implies the others', () => {
    show({
      sources: [
        { fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 },
        { fileId: 'b', fileName: 'regulamin.pdf', chunkCount: 1 },
      ],
      chunkCount: 5,
      durationMs: 120,
    });

    const region = screen.getByRole('region', { name: 'Sources' });
    expect(region).toHaveTextContent('Searched 2 documents');
    expect(region).toHaveTextContent('5 chunks');
    expect(region).toHaveTextContent('120 ms');
  });

  it('omits chunks and time for a turn read back from the database', () => {
    // Neither is stored, so a reopened thread has no number to print. A zero
    // would read as "looked at nothing in no time" — a claim about the
    // retrieval rather than about what the record kept.
    show({ chunkCount: undefined, durationMs: undefined });

    const region = screen.getByRole('region', { name: 'Sources' });
    expect(region).toHaveTextContent('Searched 1 document');
    expect(region).not.toHaveTextContent('chunk');
    expect(region).not.toHaveTextContent('ms');
    // And no orphan separator left where the segments were.
    expect(region.textContent).not.toContain('· ·');
    expect(region.textContent).not.toMatch(/document\s*·\s*$/);
  });

  it('says "1 document", not "1 documents"', () => {
    // The counts are ICU plurals. English only needs two forms and would have
    // survived a naive string; Polish needs four, and "Przeszukano 1
    // dokumentów" was what shipped in the first draft.
    show({
      sources: [{ fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 }],
      chunkCount: 1,
    });

    const region = screen.getByRole('region', { name: 'Sources' });
    expect(region).toHaveTextContent('Searched 1 document');
    expect(region).not.toHaveTextContent('1 documents');
    expect(region).toHaveTextContent('1 chunk');
    expect(region).not.toHaveTextContent('1 chunks');
  });

  it('lists what was retrieved, not only what was cited', () => {
    // A question that searched five documents and used none of them is a fact
    // about the knowledge base; showing only the cited ones would hide it.
    show({
      sources: [
        { fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 },
        { fileId: 'b', fileName: 'regulamin.pdf', chunkCount: 1 },
      ],
      citedFileIds: ['a'],
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(row('umowa.pdf')).toHaveAttribute('data-cited', 'true');
    expect(row('regulamin.pdf')).toHaveAttribute('data-cited', 'false');
  });

  /**
   * Cited and uncited are two lists, not one list with a badge. The state is
   * carried by which group a card is in and by the disclosure that names the
   * rest — no colour, and no word repeated on every card in the top group.
   */
  it('puts a cited source in the open list', () => {
    show({ citedFileIds: ['a'] });

    expect(row('umowa.pdf')).toHaveAttribute('data-cited', 'true');
    expect(row('umowa.pdf').closest('details')).toBeNull();
  });

  it('collapses an uncited source behind the disclosure', () => {
    show({
      sources: [
        { fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 },
        { fileId: 'b', fileName: 'regulamin.pdf', chunkCount: 1 },
      ],
      citedFileIds: ['a'],
    });

    expect(row('regulamin.pdf').closest('details')).not.toBeNull();
    expect(screen.getByText('Show 1 more source')).toBeInTheDocument();
  });

  /**
   * Collapsed, never dropped. A `[n]` chip is built for every retrieved
   * source, so removing a row would leave a chip pointing at nothing.
   */
  it('keeps the anchor of a collapsed source in the document', () => {
    show({
      sources: [
        { fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 },
        { fileId: 'b', fileName: 'regulamin.pdf', chunkCount: 1 },
      ],
      citedFileIds: ['a'],
    });

    expect(row('regulamin.pdf')).toHaveAttribute('id', 'src-m1-2');
  });

  it('says so when retrieval found documents the answer did not use', () => {
    show({ citedFileIds: [] });

    expect(
      screen.getByText('The answer did not cite any of them'),
    ).toBeInTheDocument();
  });

  it('quotes the passage the model read', () => {
    show({
      sources: [
        {
          fileId: 'a',
          fileName: 'umowa.pdf',
          chunkCount: 1,
          snippet: 'Trains must be booked in second class.',
        },
      ],
      citedFileIds: ['a'],
    });

    expect(
      screen.getByText('Trains must be booked in second class.'),
    ).toBeInTheDocument();
  });

  it('marks neither of two identically named files', () => {
    // The decision in `attributable-citations.ts`, reaching the screen: a
    // missing mark is a smaller lie than one pointing at a document the answer
    // may never have drawn on.
    show({
      sources: [
        { fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 },
        { fileId: 'b', fileName: 'umowa.pdf', chunkCount: 1 },
      ],
      citedFileIds: ['a', 'b'],
    });

    expect(screen.queryByText('cited')).not.toBeInTheDocument();
    for (const item of screen.getAllByRole('listitem')) {
      expect(item).toHaveAttribute('data-cited', 'false');
    }
  });

  describe('the relevance bar', () => {
    // Reranking is opt-in, so most deployments measure nothing at all. The
    // distinction that matters is between "not measured" and "scored zero".
    it('shows the score as a percentage, not only as a bar', () => {
      // A bar alone is a visual-only encoding, and it is the only version a
      // screen reader cannot read.
      show({
        sources: [
          {
            fileId: 'a',
            fileName: 'umowa.pdf',
            relevanceScore: 0.83,
            chunkCount: 1,
          },
        ],
      });

      expect(screen.getByText('83%')).toBeInTheDocument();
    });

    it('says what the percentage measures, for a reader who cannot see the bar', () => {
      // `title` is not reliably announced and is unreachable by touch, so the
      // label is real text rather than an attribute.
      show({
        sources: [
          {
            fileId: 'a',
            fileName: 'umowa.pdf',
            relevanceScore: 0.83,
            chunkCount: 1,
          },
        ],
      });

      expect(
        screen.getByText((_, el) => el?.textContent === 'relevance: 83%'),
      ).toBeInTheDocument();
    });

    it('draws nothing when reranking did not run', () => {
      // An empty bar reads as "scored zero", which is a claim about the
      // document rather than about the deployment.
      show({
        sources: [{ fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 }],
      });

      expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    });

    it('distinguishes a real zero from an absent score', () => {
      show({
        sources: [
          {
            fileId: 'a',
            fileName: 'umowa.pdf',
            relevanceScore: 0,
            chunkCount: 1,
          },
        ],
      });

      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('keeps an out-of-range score inside its track', () => {
      // The width is a layout instruction as well as a claim.
      show({
        sources: [
          {
            fileId: 'a',
            fileName: 'umowa.pdf',
            relevanceScore: 1.4,
            chunkCount: 1,
          },
        ],
      });

      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  it('says so when retrieval ran and matched nothing', () => {
    // Only reachable when the knowledge base *was* searched — the event is
    // never sent otherwise — so this cannot stand in for "did not look".
    show({ sources: [], chunkCount: 0 });

    expect(
      screen.getByText('Nothing matched in your documents'),
    ).toBeInTheDocument();
  });

  it('still lists a chunk whose file name was never stored', () => {
    // Dropping it would make the document count disagree with the list.
    show({ sources: [{ fileId: 'legacy-id', fileName: null, chunkCount: 1 }] });

    expect(screen.getByText('legacy-id')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sources' })).toHaveTextContent(
      'Searched 1 document',
    );
  });

  it('numbers each row, so a `[n]` in the answer has somewhere to land', () => {
    show({
      sources: [
        { fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 },
        { fileId: 'b', fileName: 'regulamin.pdf', chunkCount: 1 },
      ],
    });

    // The number is the rank order the model was given, so the first row is
    // `[1]` and the chip pointing at it links to this id.
    expect(row('umowa.pdf')).toHaveAttribute('id', 'src-m1-1');
    expect(row('regulamin.pdf')).toHaveAttribute('id', 'src-m1-2');
    expect(row('umowa.pdf')).toHaveTextContent('1');
    expect(row('regulamin.pdf')).toHaveTextContent('2');
  });

  it('namespaces its ids, because a thread renders many answers at once', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SourcesBlock
          idPrefix="src-m2"
          retrieval={{
            sources: [{ fileId: 'a', fileName: 'inny.pdf', chunkCount: 1 }],
            chunkCount: 1,
            durationMs: 10,
            citedFileIds: [],
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(row('inny.pdf')).toHaveAttribute('id', 'src-m2-1');
    expect(
      screen
        .getByRole('region', { name: 'Sources' })
        .getAttribute('aria-labelledby'),
    ).toBe('src-m2-heading');
  });

  it('shows the page when the parser knew one', () => {
    show({
      sources: [
        { fileId: 'a', fileName: 'umowa.pdf', sourcePage: 7, chunkCount: 1 },
      ],
    });

    expect(row('umowa.pdf')).toHaveTextContent('page 7');
  });

  it('shows no page when the parser did not know one', () => {
    // Absence is the discriminator. A document ingested before Docling
    // reported pages must not be labelled "page 1" — that is a guess wearing
    // the clothes of a fact, and it is the bug the old `page_number` had.
    show({ sources: [{ fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 }] });

    expect(row('umowa.pdf')).not.toHaveTextContent(/page/i);
  });

  it.each([
    ['zero', 0],
    ['a fraction', 1.5],
    ['infinity', Number.POSITIVE_INFINITY],
    ['not a number', Number.NaN],
    ['a negative', -3],
  ])('does not treat %s as a page', (_name, value) => {
    show({
      sources: [
        {
          fileId: 'a',
          chunkCount: 1,
          fileName: 'umowa.pdf',
          sourcePage: value as unknown as number,
        },
      ],
    });

    // These arrive over the network. The chain filters them, and this is the
    // second check — "page 1.5" and "page Infinity" are worse to print than
    // nothing at all.
    expect(row('umowa.pdf')).not.toHaveTextContent(/page/i);
  });

  it('does not treat page zero as a page', () => {
    show({
      sources: [
        {
          fileId: 'a',
          chunkCount: 1,
          fileName: 'umowa.pdf',
          sourcePage: 0 as unknown as number,
        },
      ],
    });

    // Zero is not a page anyone can turn to; the chain filters it out before
    // this component sees it, and if one arrives the render must not claim
    // "page 0".
    expect(row('umowa.pdf')).not.toHaveTextContent('page 0');
  });
});

/**
 * Picking a source.
 *
 * Before this the block had no button, no link and no handler — the cards were
 * text. `onActivate` is optional so the read-only rendering survives: a public
 * share and a guest thread have no preview to open, and a card that clicks into
 * nothing is worse than one that does not invite the click.
 */
describe('SourcesBlock — activating a source', () => {
  const sources = [
    { fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1, sourcePage: 7 },
    { fileId: 'b', fileName: 'regulamin.pdf', chunkCount: 2 },
  ];

  it('renders no control at all when it has nowhere to send the reader', () => {
    show({ sources, citedFileIds: ['a'] });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('makes each card one control, named after its document', () => {
    show({ sources, citedFileIds: ['a', 'b'] }, vi.fn());

    // Named by document, not "source 2": a list of ordinals is a list of
    // nothing to anyone reading it aloud.
    expect(
      screen.getByRole('button', { name: 'Open umowa.pdf' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open regulamin.pdf' }),
    ).toBeInTheDocument();
    // One target per card — the failure panel rule 14 guards against is a row
    // where the destination depends on which characters you hit.
    expect(within(row('umowa.pdf')).getAllByRole('button')).toHaveLength(1);
  });

  it('hands back the source that was picked, not its index', () => {
    const onActivate = vi.fn();
    show({ sources, citedFileIds: ['a', 'b'] }, onActivate);

    screen.getByRole('button', { name: 'Open regulamin.pdf' }).click();

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'b', fileName: 'regulamin.pdf' }),
    );
  });

  it('carries the page and the regions the preview needs', async () => {
    // The handler gets the whole source, so whatever opens it can place the
    // view without a second lookup.
    const onActivate = vi.fn();
    const regions = [{ page: 7, x: 0.05, y: 0.2, w: 0.9, h: 0.06 }];
    show(
      {
        sources: [{ ...sources[0], sourceRegions: regions }],
        citedFileIds: ['a'],
      },
      onActivate,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Open umowa.pdf' }),
    );

    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePage: 7, sourceRegions: regions }),
    );
  });

  it('activates a collapsed source too', async () => {
    const onActivate = vi.fn();
    show({ sources, citedFileIds: ['a'] }, onActivate);

    // Uncited sources live behind the disclosure but are in the document, the
    // same reason their anchors are: a `[n]` chip is built for every retrieved
    // source, not only the cited ones.
    await userEvent.click(
      screen.getByRole('button', { name: 'Open regulamin.pdf' }),
    );

    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'b' }),
    );
  });

  it('keeps the row anchor outside the control', async () => {
    // The `[n]` chips scroll to the `<li>` id. Moving it onto the button would
    // change what a fragment navigation focuses and what `:target` styles.
    show({ sources, citedFileIds: ['a'] }, vi.fn());

    expect(row('umowa.pdf')).toHaveAttribute('id', 'src-m1-1');
  });

  it('still names a file whose name was never stored', async () => {
    const onActivate = vi.fn();
    show(
      { sources: [{ fileId: 'orphan-id', fileName: null, chunkCount: 1 }] },
      onActivate,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Open orphan-id' }),
    );

    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'orphan-id' }),
    );
  });
});
