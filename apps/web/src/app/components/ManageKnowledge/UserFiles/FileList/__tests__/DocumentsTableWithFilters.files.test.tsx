import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { DocumentsTableWithFilters } from '../DocumentsTableWithFilters';
import { EmbeddingStatus } from '@/generated/prisma/browser';
import type { FileType, PiiPolicy } from '@/generated/prisma/browser';
import type { UserFileType } from '@/features/documents/contracts/document.types';
import type { PaginatedUserFilesResult } from '@/features/documents/contracts/document.types';

vi.mock('@/app/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const mockRouterPush = vi.fn();
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: vi.fn(() => '/pl/knowledge/documents-list'),
  Link: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@ragenai/common-ui/Tooltip', () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('@/app/hooks/useOnClickOutside', () => ({
  useOnClickOutside: () => {},
}));

const messages = {
  'files-table': {
    'file-name': 'File Name',
    'file-size': 'File Size',
    created: 'Created',
    processed: 'Processed',
    'sort-file-name': 'File Name',
    'sort-file-size': 'File Size',
    'sort-created': 'Date Added',
    'sort-file-type': 'Type',
    'filter-file-type': 'File type',
    'filter-file-type-all': 'All types',
    'filter-embedding-status': 'Status',
    'filter-embedding-status-all': 'All statuses',
    'filter-status-not-started': 'Pending',
    'filter-status-started': 'Processing',
    'filter-status-completed': 'Completed',
    'filter-status-failed': 'Failed',
    'reset-filters': 'Reset filters',
    'no-results-for-filters': 'No documents match the selected filters',
    'no-files': 'No files',
    'sort-label': 'Sort',
    'sort-dir-asc': 'Ascending',
    'sort-dir-desc': 'Descending',
    'status-ready': 'Ready',
    'status-processing': 'Processing',
    'status-failed': 'Failed',
    'status-uploading': 'Uploading',
    'score-rag': 'Score for RAG',
    delete: 'Delete',
    edit: 'Edit',
    view: 'View',
    preview: 'Preview',
    download: 'Download',
    move: 'Move',
    share: 'Share',
    'pagination-range': '{from}-{to} of {total}',
    'clear-all-filters': 'Clear all',
  },
  'bulk-action-bar': {
    'aria-label': 'Bulk file operations',
    selected: '{count} selected',
    'select-all': 'Select all',
    'select-file': 'Select {fileName}',
    clear: 'Clear selection',
    delete: 'Delete',
    move: 'Move',
    share: 'Share',
    reembed: 'Re-embed',
  },
  folders: {
    title: 'Folders',
    'all-files': 'All Files',
    'my-files': 'My Files',
    'shared-with-me': 'Shared with me',
    'no-documents': 'No documents in knowledge base',
    'drag-drop': 'Drag & drop files here',
    'upload-cta': 'Upload file',
    'create-document': 'Create document',
    'add-from-url': 'Add from URL',
  },
  'document-optimizer': {
    'badge-label': 'RAG: {score}',
    'score-tooltip': 'RAG readiness: {score}/100.',
  },
  'file-delete-modal': {
    title: 'Delete file',
    description: 'Are you sure you want to delete {fileName}?',
    deleting: 'Deleting...',
    delete: 'Delete',
    cancel: 'Cancel',
  },
};

const makeFile = (id: string, name: string): UserFileType => ({
  id,
  organizationId: 'org-1',
  fileName: name,
  fileSize: 1024,
  fileType: 'PDF',
  projectId: 'proj-1',
  project: null,
  embeddingStatus: EmbeddingStatus.COMPLETED,
  embeddingStartedAt: null,
  embeddingCompletedAt: null,
  embeddingFailedAt: null,
});

const makeResult = (items: UserFileType[]): PaginatedUserFilesResult => ({
  items,
  page: 1,
  pageSize: 25,
  totalCount: items.length,
  totalPages: 1,
});

const baseProps = {
  sort: 'createdAt' as const,
  dir: 'desc' as const,
  selectedFileTypes: [] as FileType[],
  selectedStatuses: [] as EmbeddingStatus[],
  selectedPolicies: [] as PiiPolicy[],
  showModal: { isOpen: false, fileId: null },
  deleteLoading: false,
  toggleModal: vi.fn(),
  addFile: vi.fn(),
  removeFile: vi.fn(),
  handleDelete: vi.fn(),
};

function renderComponent(
  props: Partial<typeof baseProps> & {
    result: PaginatedUserFilesResult;
    files?: UserFileType[];
    search?: React.ReactNode;
    viewToggle?: React.ReactNode;
    selectionBar?: React.ReactNode;
  },
) {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <DocumentsTableWithFilters {...baseProps} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('DocumentsTableWithFilters — prop files', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRouterPush.mockClear();
  });

  it('wyświetla pliki z result.items gdy files nie jest podany', () => {
    const result = makeResult([
      makeFile('a', 'alfa.pdf'),
      makeFile('b', 'beta.pdf'),
    ]);
    renderComponent({ result });

    expect(screen.getByText('alfa.pdf')).toBeInTheDocument();
    expect(screen.getByText('beta.pdf')).toBeInTheDocument();
  });

  it('wyświetla pliki z prop files zamiast result.items gdy files jest podany', () => {
    const result = makeResult([
      makeFile('a', 'alfa.pdf'),
      makeFile('b', 'beta.pdf'),
    ]);
    const filteredFiles = [makeFile('a', 'alfa.pdf')];
    renderComponent({ result, files: filteredFiles });

    expect(screen.getByText('alfa.pdf')).toBeInTheDocument();
    expect(screen.queryByText('beta.pdf')).not.toBeInTheDocument();
  });

  it('wyświetla pustą tabelę gdy files=[] mimo niepustego result.items', () => {
    const result = makeResult([makeFile('a', 'alfa.pdf')]);
    renderComponent({ result, files: [] });

    expect(screen.queryByText('alfa.pdf')).not.toBeInTheDocument();
    // Pusta tabela — brak wierszy danych
    expect(
      screen.queryByRole('row', { name: /alfa/i }),
    ).not.toBeInTheDocument();
  });

  it('używa result.items gdy files jest undefined (fallback)', () => {
    const result = makeResult([makeFile('c', 'gamma.pdf')]);
    renderComponent({ result, files: undefined });

    expect(screen.getByText('gamma.pdf')).toBeInTheDocument();
  });

  it('paginacja opiera się na result, nie na files', () => {
    const allItems = Array.from({ length: 3 }, (_, i) =>
      makeFile(`id-${i}`, `file-${i}.pdf`),
    );
    const result: PaginatedUserFilesResult = {
      ...makeResult(allItems),
      page: 1,
      pageSize: 25,
      totalCount: 60,
      totalPages: 3,
    };
    const files = [allItems[0]];
    renderComponent({ result, files });

    // Zakres liczony z result (strona 1 z 25 na stronę, 60 łącznie), nie z
    // files.length=1 — tabela pokazuje wycinek tego, co zwrócił serwer.
    expect(screen.getByText('1-25 of 60')).toBeInTheDocument();
  });

  /**
   * `page` pochodzi z query stringa i jest ograniczany tylko od dołu, więc
   * `?page=999` da się wpisać. Tabela jest wtedy pusta i zakres ma to
   * powiedzieć, zamiast pokazywać "24951-60 z 60".
   */
  it('pokazuje pusty zakres dla strony poza końcem listy', () => {
    const result: PaginatedUserFilesResult = {
      ...makeResult([]),
      page: 999,
      pageSize: 25,
      totalCount: 60,
      totalPages: 3,
    };
    renderComponent({ result, files: [] });

    expect(screen.getByText('0-0 of 60')).toBeInTheDocument();
  });

  /**
   * Kontrolki paginacji są wtedy jedyną drogą powrotu, więc muszą się
   * pojawić nawet gdy lista ma jedną stronę — inaczej `?page=999` zostawia
   * pustą tabelę i nic, co by o tym mówiło.
   */
  it('pokazuje paginację dla strony poza końcem jednostronicowej listy', () => {
    const result: PaginatedUserFilesResult = {
      ...makeResult([]),
      page: 999,
      pageSize: 25,
      totalCount: 3,
      totalPages: 1,
    };
    renderComponent({ result, files: [] });

    expect(screen.getByText('0-0 of 3')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Page navigation' }),
    ).toBeInTheDocument();
  });

  /** A dla zwykłej jednostronicowej listy paginacji nadal nie ma. */
  it('nie pokazuje paginacji dla jednej strony w zakresie', () => {
    const result: PaginatedUserFilesResult = {
      ...makeResult([makeFile('a', 'alfa.pdf')]),
      page: 1,
      pageSize: 25,
      totalCount: 1,
      totalPages: 1,
    };
    renderComponent({ result });

    expect(
      screen.queryByRole('navigation', { name: 'Page navigation' }),
    ).not.toBeInTheDocument();
  });

  /**
   * Ostatnia strona nie może wyjść poza sumę: 3 × 25 to 75, a rekordów jest
   * 60, więc zakres kończy się na 60.
   */
  it('przycina zakres ostatniej strony do sumy rekordów', () => {
    const allItems = Array.from({ length: 3 }, (_, i) =>
      makeFile(`id-${i}`, `file-${i}.pdf`),
    );
    const result: PaginatedUserFilesResult = {
      ...makeResult(allItems),
      page: 3,
      pageSize: 25,
      totalCount: 60,
      totalPages: 3,
    };
    renderComponent({ result, files: allItems });

    expect(screen.getByText('51-60 of 60')).toBeInTheDocument();
  });
});

/**
 * Phase 7 puts search, the chips and the view toggle in one row, and the
 * selection bar directly above the table header. The three used to be rows of
 * their own between the title and the table, which left the selection count
 * two bands away from the checkboxes that produced it.
 */
describe('DocumentsTableWithFilters — the filter row', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRouterPush.mockClear();
  });

  it('renders search, the view toggle and the selection bar where it is given them', () => {
    renderComponent({
      result: makeResult([makeFile('a', 'alfa.pdf')]),
      search: <input aria-label="Search file names" />,
      viewToggle: <button type="button">Grid</button>,
      selectionBar: <div data-testid="selection-bar">2 selected</div>,
    });

    expect(
      screen.getByRole('textbox', { name: 'Search file names' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grid' })).toBeInTheDocument();
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
  });

  it('puts search ahead of the chips, and the selection bar ahead of the table', () => {
    const { container } = renderComponent({
      result: makeResult([makeFile('a', 'alfa.pdf')]),
      search: <input aria-label="Search file names" />,
      selectionBar: <div data-testid="selection-bar">2 selected</div>,
    });

    const search = screen.getByRole('textbox', { name: 'Search file names' });
    const chips = screen.getByTestId('filter-file-type');
    const bar = screen.getByTestId('selection-bar');
    const table = container.querySelector('table')!;

    expect(
      search.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      bar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /**
   * "Clear all", the design's word. It appears only once a filter is set —
   * a link offering to clear nothing is noise.
   */
  it('offers Clear all once a filter is set, and not before', () => {
    const result = makeResult([makeFile('a', 'alfa.pdf')]);
    const { unmount } = renderComponent({ result });

    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
    unmount();

    renderComponent({ result, selectedStatuses: [EmbeddingStatus.STARTED] });

    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  /**
   * The sort chip used to render in the grid only — the table has sortable
   * column headers, so a second control there looked redundant — and the
   * toolbar gained and lost a control as you toggled the view, moving every
   * chip beside it.
   */
  it('carries the sort chip in the table view too, so the toolbar does not change shape', () => {
    renderComponent({ result: makeResult([makeFile('a', 'alfa.pdf')]) });

    expect(screen.getByTestId('sort-chip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sort:/ })).toHaveTextContent(
      'Sort: Date Added',
    );
  });

  it('writes the chip’s column and direction to the URL, and goes back to page one', async () => {
    const user = userEvent.setup();
    renderComponent({
      result: { ...makeResult([makeFile('a', 'alfa.pdf')]), page: 3 },
    });

    await user.click(screen.getByRole('button', { name: /^Sort:/ }));
    await user.click(screen.getByRole('button', { name: /File Size — Asc/i }));

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining('sort=fileSize'),
    );
    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining('dir=asc'),
    );
    // A different sort renumbers the pages, so page 3 of the old order is not
    // page 3 of the new one.
    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining('page=1'),
    );
  });

  /**
   * The structural half of "only the rows scroll".
   *
   * The toolbar, the selection bar and the pagination strip used to live
   * inside the same `overflow-y-auto` box as the table, so the filters you
   * were working with and the pager telling you how many rows there were both
   * scrolled away with the rows — on a full page the pager sat under the fold.
   * They are siblings of the scroller now, and this is the assertion that
   * stops them drifting back inside it.
   */
  it('keeps the toolbar and the pager outside the scrolling region', () => {
    const { container } = renderComponent({
      result: {
        ...makeResult([makeFile('a', 'alfa.pdf')]),
        page: 1,
        pageSize: 25,
        totalCount: 60,
        totalPages: 3,
      },
      search: <input aria-label="Search file names" />,
      selectionBar: <div data-testid="selection-bar">2 selected</div>,
    });

    const table = container.querySelector('table')!;
    const scroller = table.parentElement!;
    expect(scroller.className).toContain('overflow-y-auto');

    for (const chrome of [
      screen.getByRole('textbox', { name: 'Search file names' }),
      screen.getByTestId('sort-chip'),
      screen.getByTestId('filter-file-type'),
      screen.getByTestId('selection-bar'),
      screen.getByText('1-25 of 60'),
    ]) {
      expect(scroller.contains(chrome)).toBe(false);
    }
  });
});
