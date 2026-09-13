import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { NextIntlClientProvider } from 'next-intl';

import messages from '@/app/messages/en.json';
import assistantReducer from '@/store/assistant/assistantSlice';
import type { MessageDto } from '@/features/messages/contracts/message.types';

vi.mock('@/app/hooks/use-auth', () => ({
  useUser: () => ({ user: undefined }),
}));

// The logger picks its implementation with a bare `require` that webpack
// rewrites at build time; vitest has no such alias, so the real module
// cannot load here.
vi.mock('@/app/lib/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ChatOutput } from '../ChatOutput';

/**
 * The regression this file exists for: the sources block was written, tested
 * and merged into `MessageItem`, which nothing rendered. Everything below
 * passed while the feature was invisible in the product, so these assertions
 * go through `ChatOutput` — the component the chat screens actually mount.
 */

const answer: MessageDto = {
  id: 'm1',
  role: 'ASSISTANT',
  content: 'The limit is 50 MB [1]. Nothing says otherwise [9].',
  createdAt: new Date('2026-09-10T08:00:00Z').toISOString(),
} as MessageDto;

const storeWithRetrieval = () =>
  configureStore({
    reducer: { assistant: assistantReducer, toolApprovals: () => ({}) },
    preloadedState: {
      assistant: {
        ...assistantReducer(undefined, { type: '@@INIT' }),
        retrievalByMessage: {
          m1: {
            sources: [{ fileId: 'a', fileName: 'umowa.pdf', chunkCount: 1 }],
            chunkCount: 2,
            durationMs: 90,
            citedFileIds: ['a'],
          },
        },
      },
    },
  });

const emptyStore = () =>
  configureStore({
    reducer: { assistant: assistantReducer, toolApprovals: () => ({}) },
  });

const show = (
  store = storeWithRetrieval(),
  shown: MessageDto[] = [answer],
  props: { isPublicAccess?: boolean } = {},
) =>
  render(
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatOutput
          messages={shown}
          isLoading={false}
          loadingMessage=""
          streamedMessage={null}
          {...props}
        />
      </NextIntlClientProvider>
    </Provider>,
  );

describe('ChatOutput citations', () => {
  it('renders the sources block for an answer that has retrieval', () => {
    show();

    expect(screen.getByRole('region', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByText('umowa.pdf')).toBeInTheDocument();
  });

  it('turns a valid marker into a chip pointing at its row', () => {
    const { container } = show();

    const chip = container.querySelector('.citation-chip');
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute('href', '#ragen-source-m1-1');
    expect(chip).toHaveAttribute('aria-label', 'Source 1: umowa.pdf');

    const row = screen.getByText('umowa.pdf').closest('li');
    expect(row).toHaveAttribute('id', 'ragen-source-m1-1');
  });

  it('leaves a marker no source could answer for as text', () => {
    const { container } = show();

    expect(container.querySelectorAll('.citation-chip')).toHaveLength(1);
    expect(container.textContent).toContain('[9]');
  });

  it('renders no sources block, and no chips, without retrieval', () => {
    const { container } = show(emptyStore());

    expect(screen.queryByRole('region', { name: 'Sources' })).toBeNull();
    expect(container.querySelectorAll('.citation-chip')).toHaveLength(0);
    // The marker stays readable rather than being stripped.
    expect(container.textContent).toContain('[1]');
  });
});

/**
 * A reopened thread: the store is empty because nothing streamed, and the
 * retrieval rides on the message instead. This is the regression the feature
 * was merged without — the query read the rows back and no component asked
 * for them, so every reopened answer showed its `[n]` as bare text.
 */
describe('ChatOutput citations — a reopened thread', () => {
  const reopened: MessageDto = {
    ...answer,
    retrieval: {
      sources: [{ fileId: 'a', fileName: 'umowa.pdf' }],
      citedFileIds: ['a'],
    },
  };

  it('renders the sources block from the message when the store has nothing', () => {
    show(emptyStore(), [reopened]);

    expect(screen.getByRole('region', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByText('umowa.pdf')).toBeInTheDocument();
    expect(screen.getByText('umowa.pdf').closest('li')).toHaveAttribute(
      'data-cited',
      'true',
    );
  });

  it('turns the marker into a chip pointing at its row', () => {
    const { container } = show(emptyStore(), [reopened]);

    const chip = container.querySelector('.citation-chip');
    expect(chip).toHaveAttribute('href', '#ragen-source-m1-1');
    expect(screen.getByText('umowa.pdf').closest('li')).toHaveAttribute(
      'id',
      'ragen-source-m1-1',
    );
  });

  it('omits the chunk count and duration it cannot know', () => {
    show(emptyStore(), [reopened]);

    expect(screen.getByText('Searched 1 document')).toBeInTheDocument();
    // Not "0 chunks · 0 ms", which would describe the retrieval rather than
    // the record.
    expect(screen.queryByText(/chunk/)).toBeNull();
    expect(screen.queryByText(/ms/)).toBeNull();
  });

  it('prefers the live turn, which knows more than the stored copy', () => {
    // Both present: the answer just streamed, and a refetch put the thinner
    // persisted copy on the same message. Losing the chunk count and the
    // duration mid-turn would look like the block flickering.
    show(storeWithRetrieval(), [reopened]);

    expect(screen.getByText(/2 chunks/)).toBeInTheDocument();
    expect(screen.getByText(/90 ms/)).toBeInTheDocument();
  });
});

/**
 * Who gets a source card that can be opened.
 *
 * `SourcesBlock` renders a control only when it is handed an `onActivate`, and
 * that is deliberate: the panel it opens fetches the document from
 * `/api/files/{id}`, which needs a session and the file's own access check. On
 * a public share there is neither, so the card would open onto "Failed to load
 * file." A card that clicks into nothing is worse than one that does not
 * invite the click.
 *
 * The cards themselves stay either way — what the answer was grounded in is
 * worth showing to anyone who can read the answer.
 */
describe('ChatOutput citations — a read-only view', () => {
  it('offers no control on a public thread', () => {
    show(storeWithRetrieval(), [answer], { isPublicAccess: true });

    expect(screen.getByRole('region', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByText('umowa.pdf')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open umowa.pdf' }),
    ).not.toBeInTheDocument();
  });

  it('offers the control on an ordinary thread', () => {
    // The guard on the guard: without this, deleting the whole feature would
    // satisfy the assertion above.
    show(storeWithRetrieval(), [answer]);

    expect(
      screen.getByRole('button', { name: 'Open umowa.pdf' }),
    ).toBeInTheDocument();
  });
});
