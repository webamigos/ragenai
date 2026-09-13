'use client';

import { useTranslations } from 'next-intl';
import { DocumentTextIcon } from '@heroicons/react/24/outline';

import { cn } from '@/lib/utils';
import { attributableCitations } from '@/features/documents/utils/attributable-citations';
import { RelevanceBar } from './RelevanceBar';
import type {
  MessageRetrieval,
  RetrievalSource,
} from '@/store/assistant/assistantSlice';

/**
 * What the answer was grounded in.
 *
 * Gap 2, stage 1. It renders the **retrieved** set — the documents the model
 * was shown — and marks the ones the answer went on to cite. Showing only the
 * cited ones would hide the more useful half: a question that searched five
 * documents and used none of them is a fact about the knowledge base, and an
 * empty block says it better than no block at all.
 *
 * Cited is decided from the answer text. Since stage 2 that is a validated
 * `[n]` marker wherever the model wrote one, and file-name matching only for
 * answers that wrote none — see `cited-sources.ts`. Each row carries its
 * number, and it is the same number the answer cites, so a chip in the prose
 * and a row here are two views of one fact.
 *
 * A reopened thread renders this too, from the rows `document_retrievals`
 * and `document_citations` kept. What it cannot render there is the chunk
 * count, the duration and the relevance bars: those measure a run that has
 * finished and nothing stores them, so each segment appears only when there
 * is a number behind it rather than a zero standing in for one.
 */
type Props = {
  retrieval: MessageRetrieval;
  /**
   * Namespace for the row ids the `[n]` chips in the answer link to. One per
   * message, because a thread renders many answers and an `id` is unique per
   * document, not per bubble.
   */
  idPrefix: string;
  /**
   * What to do when a reader picks a source, if anything.
   *
   * Optional, and its absence is the read-only rendering this block has always
   * had: a card that cannot be opened must not look like a button. A public
   * share and a guest thread reach this component without a preview to open,
   * and a card that clicks into nothing is worse than one that does not
   * invite the click.
   */
  onActivate?: (source: RetrievalSource) => void;
  className?: string;
};

/**
 * One source the reader can check: its number, its name, the page when the
 * parser knew one, and the passage the model actually read.
 *
 * The number is the source's position in the *retrieved* order, not its
 * position in this list. `sources` arrives deduped and in final rank order and
 * `operations.ts` numbers it by that index, so this is a read of the same fact
 * the model was given rather than a second numbering free to disagree with it.
 */
const SourceCard = ({
  source,
  idPrefix,
  isCited = false,
  onActivate,
}: {
  source: NumberedSource;
  idPrefix: string;
  isCited?: boolean;
  onActivate?: (source: RetrievalSource) => void;
}) => {
  const t = useTranslations('sources');

  /*
    One target, not two. The card has no other interactive element in it, so
    making the whole row the control is the exception panel rule 14 allows —
    the failure it guards against is a row where a click lands somewhere
    different depending on which few characters you hit.

    A `<button>` rather than a link: this opens a panel over the thread, it
    does not navigate, and there is no URL that would restore it.
  */
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        {/*
          Crimson, and only here: the panel rules ration it to five jobs and
          citation markers are one of them. Same number, same colour as the
          chip that points at it, which is the whole reason a reader can
          follow one to the other.
        */}
        <span
          aria-hidden="true"
          className="w-4 shrink-0 text-right font-medium tabular-nums text-marker"
        >
          {source.number}
        </span>
        <DocumentTextIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span
          className={cn(
            'min-w-0 truncate',
            isCited ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {/*
            A chunk ingested before file names were stored has no name to
            show. It is still listed: it was retrieved, and dropping it would
            make the count disagree with the list.
          */}
          {source.fileName ?? source.fileId}
        </span>
        {/*
          The page, when the parser knew one — gap 3. Rendered only when
          present, never defaulted: a document ingested before Docling
          reported pages has no page, and "page 1" would be a guess wearing
          the clothes of a fact.

          Whole page, at least 1, checked here as well as in the chain. This
          value arrives over the network, and a component should not render a
          number it cannot justify because something upstream promised not to
          send one. `>= 1` alone let `1.5` and `Infinity` through: neither is
          a page anyone can turn to.
        */}
        {typeof source.sourcePage === 'number' &&
        Number.isInteger(source.sourcePage) &&
        source.sourcePage >= 1 ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {t('page', { page: source.sourcePage })}
          </span>
        ) : null}
        {/*
          No bar when there is no score, rather than an empty one. Reranking
          is opt-in, so a default installation measures nothing — and an empty
          bar reads as "scored zero", which is a claim about the document
          rather than about the deployment.
        */}
        {typeof source.relevanceScore === 'number' ? (
          <RelevanceBar score={source.relevanceScore} className="ml-auto" />
        ) : null}
      </div>
      {/*
        The passage, quoted. It is what makes a source checkable rather than
        merely named — and it is the half that was stored, encrypted and read
        back for months with nothing rendering it.

        Masked values arrive already masked: PII is replaced at ingestion, so
        the quote shows `[PESEL]` because that is what the model read, not
        because anything is hidden here.
      */}
      {source.snippet ? (
        <blockquote className="mt-1 border-l-2 border-border pl-2 text-[11px] leading-snug text-muted-foreground line-clamp-3">
          {source.snippet}
        </blockquote>
      ) : null}
    </>
  );

  return (
    <li
      id={`${idPrefix}-${source.number}`}
      data-cited={isCited}
      className="scroll-mt-24 rounded-lg border border-border bg-card text-xs target:border-marker"
    >
      {onActivate ? (
        <button
          type="button"
          onClick={() => onActivate(source)}
          /*
            Names the document rather than saying "open source 3". The
            accessible name is what a reader hears in a list of them, and a
            list of ordinals is a list of nothing.
          */
          aria-label={t('open-source', {
            name: source.fileName ?? source.fileId,
          })}
          className="block w-full cursor-pointer rounded-lg p-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {body}
        </button>
      ) : (
        <div className="p-2">{body}</div>
      )}
    </li>
  );
};

/** A source carrying the number the answer cites it by. */
type NumberedSource = RetrievalSource & { number: number };

export const SourcesBlock = ({
  retrieval,
  idPrefix,
  onActivate,
  className,
}: Props) => {
  const t = useTranslations('sources');
  const { sources, chunkCount, durationMs, citedFileIds } = retrieval;

  const cited = attributableCitations(sources, citedFileIds);
  // Numbered before the split, so a collapsed source keeps the number its
  // chip uses.
  const numbered: NumberedSource[] = sources.map((source, index) => ({
    ...source,
    number: index + 1,
  }));
  const citedSources = numbered.filter((source) => cited.has(source.fileId));
  const otherSources = numbered.filter((source) => !cited.has(source.fileId));

  return (
    <section
      className={cn('mt-3 border-t border-border pt-2', className)}
      aria-labelledby={`${idPrefix}-heading`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3
          id={`${idPrefix}-heading`}
          className="text-xs font-medium text-muted-foreground"
        >
          {t('heading')}
        </h3>
        {/*
          The retrieval row. Documents and chunks are both shown because
          neither implies the other — one document usually supplies several
          chunks, and "5 documents · 5 chunks" and "1 document · 5 chunks" are
          different answers to "how much did it look at".
        */}
        {/*
          The counts are ICU plurals, not "{n} documents". Polish needs four
          forms and got one: "Przeszukano 1 dokumentów" is wrong, and so is
          "2 dokumentów". Finnish and Hungarian are the exception — neither
          inflects the noun after a numeral, so marking plurals there would be
          wrong rather than merely redundant, and their strings stay plain.
        */}
        {/*
          Chunks and duration only when the turn is still in memory. A thread
          read back from the database has neither, and "0 chunks · 0 ms" would
          describe a retrieval that did nothing rather than a record that kept
          less — the same rule the relevance bar and the page number follow.
        */}
        <p className="text-xs text-muted-foreground/70">
          {t('searched-documents', { documents: sources.length })}
          {typeof chunkCount === 'number' ? (
            <>
              {' · '}
              {t('chunks', { chunks: chunkCount })}
            </>
          ) : null}
          {typeof durationMs === 'number' ? (
            <>
              {' · '}
              {t('duration', { ms: durationMs })}
            </>
          ) : null}
        </p>
      </div>

      {sources.length === 0 ? (
        // Reached only when retrieval ran and matched nothing. The event is
        // not sent at all when the knowledge base was never searched, so this
        // never stands in for "did not look".
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t('none-found')}
        </p>
      ) : (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {citedSources.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {citedSources.map((source) => (
                <SourceCard
                  key={source.fileId}
                  source={source}
                  idPrefix={idPrefix}
                  onActivate={onActivate}
                  isCited
                />
              ))}
            </ul>
          ) : (
            // Retrieval ran and found documents, and the answer used none of
            // them. That is a fact about the knowledge base worth stating —
            // and a different one from "nothing matched", which is the branch
            // above.
            <p className="text-xs text-muted-foreground">{t('cited-none')}</p>
          )}

          {/*
            The rest, collapsed. They are rendered rather than dropped because
            a `[n]` chip is built for every retrieved source, not only the
            cited ones, so removing a row would leave a chip pointing at
            nothing. `<details>` keeps them in the document, and a browser
            navigating to a fragment inside a closed one opens it.
          */}
          {otherSources.length > 0 ? (
            <details className="group">
              <summary className="cursor-pointer list-none text-xs text-primary marker:content-none hover:underline">
                {t('show-more', { count: otherSources.length })}
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {otherSources.map((source) => (
                  <SourceCard
                    key={source.fileId}
                    source={source}
                    idPrefix={idPrefix}
                    onActivate={onActivate}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
};
