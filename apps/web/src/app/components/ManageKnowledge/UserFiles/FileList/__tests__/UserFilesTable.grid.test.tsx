import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { UserFilesTable } from '../UserFilesTable';
import type { UserFileTypeSafe } from '../UserFilesTable';
import { EmbeddingStatus } from '@/generated/prisma/browser';
import type {
  UserFilesSort,
  UserFilesSortDir,
} from '@/features/documents/contracts/document.types';

/**
 * Design system v2 phase 7 makes this table a fixed grid: each column has a
 * declared width and the grid has a floor, so the name column never collapses
 * and the table scrolls instead.
 *
 * The structural half of that is testable and worth testing. A `<colgroup>`
 * with a different number of entries than the header has cells does not throw
 * and does not fail typecheck — the browser silently applies the widths to the
 * wrong columns, and every column after the mismatch is off by one. The two
 * conditional columns (selection, PII policy) are exactly where that happens.
 */

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

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: vi.fn(() => '/'),
  Link: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@ragenai/common-ui/Tooltip', () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('@/app/actions', () => ({
  updateFilePiiPolicy: vi.fn().mockResolvedValue(undefined),
  reembedFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/[locale]/(panel)/knowledge/optimize-document/actions', () => ({
  scoreDocumentAction: vi.fn().mockResolvedValue({ total: 80 }),
}));

const messages = {
  'files-table': {
    'sort-file-name': 'File name',
    'sort-file-size': 'Size',
    'sort-created': 'Added',
    processed: 'Status',
    'status-ready': 'Ready',
    'status-processing': 'Processing',
    'status-failed': 'Failed',
    'status-queued': 'Queued',
    'no-files': 'No files',
    delete: 'Delete',
    edit: 'Edit',
    view: 'View',
    preview: 'Preview',
    download: 'Download',
    move: 'Move',
    share: 'Share',
    'score-rag': 'Score for RAG',
    'change-pii-policy': 'Change PII policy',
  },
  'bulk-action-bar': {
    'select-all': 'Select all',
    'select-file': 'Select {fileName}',
  },
  folders: { 'file-count': '{count} files' },
  'pii-policy': {
    label: 'PII policy',
    'select-label': 'PII masking policy',
    'none-label': 'None',
    'toxic-only-label': 'Sensitive data',
    'strict-label': 'All personal data',
    'badge-none': 'No masking',
    'badge-toxic-only': 'Sensitive data',
    'badge-strict': 'All personal data',
    'tag-none': 'None',
    'tag-toxic-only': 'Sensitive',
    'tag-strict': 'All',
  },
  'document-optimizer': {
    'badge-label': 'RAG: {score}',
    'score-tooltip': 'RAG readiness: {score}/100.',
  },
};

const makeFile = (
  overrides: Partial<UserFileTypeSafe> = {},
): UserFileTypeSafe =>
  ({
    id: 'file-1',
    organizationId: 'org-1',
    fileName: 'test.pdf',
    fileSize: 1024,
    fileType: 'PDF',
    projectId: 'proj-1',
    project: null,
    embeddingStatus: EmbeddingStatus.COMPLETED,
    embeddingStartedAt: null,
    embeddingCompletedAt: null,
    embeddingFailedAt: null,
    ...overrides,
  }) as UserFileTypeSafe;

const baseProps = {
  files: [makeFile()],
  subfolders: [],
  showModal: { isOpen: false, fileId: null },
  deleteLoading: false,
  toggleModal: vi.fn(),
  onAddFile: vi.fn(),
  onRemoveFile: vi.fn(),
  handleDelete: vi.fn(),
  sort: 'createdAt' as UserFilesSort,
  dir: 'desc' as UserFilesSortDir,
};

function renderTable(props: Record<string, unknown> = {}) {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <UserFilesTable {...baseProps} {...props} />
    </NextIntlClientProvider>,
  );
}

function columnCounts(container: HTMLElement) {
  const table = container.querySelector('table') as HTMLTableElement;
  return {
    cols: table.querySelectorAll('colgroup col').length,
    headers: table.querySelectorAll('thead th').length,
    cells: table.querySelectorAll('tbody tr:first-child td').length,
  };
}

describe('UserFilesTable — the fixed grid', () => {
  it('declares one column width per header cell, in the plainest case', () => {
    const { container } = renderTable();
    const { cols, headers, cells } = columnCounts(container);

    expect(cols).toBe(headers);
    expect(cells).toBe(headers);
  });

  it('stays aligned when the selection column appears', () => {
    const { container } = renderTable({
      onToggleFile: vi.fn(),
      isSelected: () => false,
      isAllSelected: () => false,
      isIndeterminate: () => false,
      onToggleAll: vi.fn(),
    });
    const { cols, headers, cells } = columnCounts(container);

    expect(cols).toBe(headers);
    expect(cells).toBe(headers);
  });

  it('stays aligned when the PII policy column appears', () => {
    const { container } = renderTable({ canManageOrg: true });
    const { cols, headers, cells } = columnCounts(container);

    expect(cols).toBe(headers);
    expect(cells).toBe(headers);
  });

  it('stays aligned with both conditional columns at once', () => {
    const { container } = renderTable({
      canManageOrg: true,
      onToggleFile: vi.fn(),
      isSelected: () => false,
      isAllSelected: () => false,
      isIndeterminate: () => false,
      onToggleAll: vi.fn(),
    });
    const { cols, headers, cells } = columnCounts(container);

    expect(cols).toBe(headers);
    expect(cells).toBe(headers);
  });

  it('keeps a folder row the same width as a file row', () => {
    // Folder rows are rendered by a different branch and have been missed by
    // a column change before.
    const { container } = renderTable({
      canManageOrg: true,
      subfolders: [{ id: 'f1', name: 'Contracts', fileCount: 3 }],
    });
    const table = container.querySelector('table') as HTMLTableElement;
    const rows = table.querySelectorAll('tbody tr');
    const headers = table.querySelectorAll('thead th').length;

    for (const row of Array.from(rows)) {
      expect(row.querySelectorAll('td')).toHaveLength(headers);
    }
  });

  it('shows the file type as a tag, read from the real extension', () => {
    renderTable({ files: [makeFile({ fileName: 'q3-summary.xlsx' })] });

    // `fileType` is PDF in the fixture on purpose: the tag reports what the
    // name says, because the enum buckets several extensions into one value.
    expect(screen.getByText('XLSX')).toBeInTheDocument();
  });

  it('renders the whole file name and lets the column truncate it', () => {
    const long = `${'a'.repeat(80)}.pdf`;
    renderTable({ files: [makeFile({ fileName: long })] });

    // The old table cut the name at 40 characters, which clipped names that
    // fit and kept names that did not. Width decides now, so the full name is
    // in the DOM and reachable by search and by a screen reader.
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it('puts the numeric columns on the right, in tabular figures', () => {
    const { container } = renderTable();
    const row = container.querySelector('tbody tr') as HTMLElement;
    const cells = Array.from(row.querySelectorAll('td'));

    const size = cells.find((c) => within(c).queryByText('1.02 kB'));
    expect(size?.className).toContain('text-right');
    expect(size?.className).toContain('tabular-nums');
  });

  it('gives the grid a floor so the name column cannot be squeezed out', () => {
    const { container } = renderTable();
    const table = container.querySelector('table') as HTMLTableElement;

    expect(table.className).toContain('table-fixed');
    expect(table.className).toContain('min-w-[840px]');
    expect((table.parentElement as HTMLElement).className).toContain(
      'overflow-x-auto',
    );
  });

  /**
   * The table's wrapper is the page's only vertical scroller: the toolbar
   * above it and the pagination strip below it stay put. `min-h-0 flex-1` is
   * what makes it take the height that is left rather than the height of its
   * own rows — without them it grows past the panel and is clipped, which
   * reads as a broken table rather than a broken box.
   */
  it('scrolls its own rows rather than the page', () => {
    const { container } = renderTable();
    const wrapper = (container.querySelector('table') as HTMLTableElement)
      .parentElement as HTMLElement;

    expect(wrapper.className).toContain('overflow-y-auto');
    expect(wrapper.className).toContain('min-h-0');
    expect(wrapper.className).toContain('flex-1');
  });

  /**
   * Three details keep the header in place while the rows move under it, and
   * every one of them is easy to undo by accident:
   *
   * - `sticky top-0` on each `<th>` — the `<thead>` and `<tr>` variants are
   *   not honoured consistently across engines;
   * - an opaque background, or the rows show through the header as they pass;
   * - `border-separate`, because under `border-collapse` the resolved border
   *   belongs to the table and is painted in the table's layer, so it does not
   *   travel with the sticky cell and the header's hairline disappears the
   *   moment you scroll.
   */
  it('pins the column names while the rows move under them', () => {
    const { container } = renderTable();
    const table = container.querySelector('table') as HTMLTableElement;

    expect(table.className).toContain('border-separate');
    expect(table.className).not.toContain('border-collapse');

    const headers = Array.from(container.querySelectorAll('thead th'));
    expect(headers.length).toBeGreaterThan(0);
    for (const th of headers) {
      expect(th.className).toContain('sticky');
      expect(th.className).toContain('top-0');
      expect(th.className).toContain('bg-card');
    }
  });

  it('opens the preview from the keyboard, through the name', () => {
    // A `<tr>` takes no focus and answers no Enter, so a row that is only
    // clickable is a row a keyboard cannot reach. The name is the control.
    const onPreviewFile = vi.fn();
    renderTable({
      onPreviewFile,
      files: [makeFile({ fileName: 'brief.pdf' })],
    });

    const name = screen.getByRole('button', { name: 'brief.pdf' });
    name.focus();
    expect(name).toHaveFocus();

    fireEvent.click(name);
    expect(onPreviewFile).toHaveBeenCalledTimes(1);
  });

  it('does not fire the preview twice when the name is clicked', () => {
    // The row listens for the click too, and the event bubbles through it.
    const onPreviewFile = vi.fn();
    renderTable({
      onPreviewFile,
      files: [makeFile({ fileName: 'brief.pdf' })],
    });

    fireEvent.click(screen.getByRole('button', { name: 'brief.pdf' }));

    expect(onPreviewFile).toHaveBeenCalledTimes(1);
  });

  it('leaves the name as text when there is no preview to open', () => {
    renderTable({ files: [makeFile({ fileName: 'brief.pdf' })] });

    expect(screen.queryByRole('button', { name: 'brief.pdf' })).toBeNull();
    expect(screen.getByText('brief.pdf')).toBeInTheDocument();
  });
});

/**
 * A row is a drag source for a move onto a folder in the rail. A shortcut,
 * never the only route — "Move" stays in the row's menu, because a drag is
 * unavailable to a keyboard and awkward on a touch screen.
 */
describe('UserFilesTable — dragging a row onto a folder', () => {
  function fakeDataTransfer() {
    const store = new Map<string, string>();
    return {
      effectAllowed: '',
      get types() {
        return Array.from(store.keys());
      },
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
    };
  }

  it('is not draggable when nothing is listening for a move', () => {
    const { container } = renderTable();
    const row = container.querySelector('tbody tr') as HTMLElement;

    expect(row).not.toHaveAttribute('draggable', 'true');
  });

  it('puts the ids the owner hands back onto the drag, not the row it started on', () => {
    // The row does not decide what the drag carries: dragging a row that is
    // part of a selection moves the whole selection, and only the component
    // holding the selection knows what that is.
    const onDragFiles = vi.fn(() => ['file-1', 'file-2']);
    const { container } = renderTable({ onDragFiles });
    const row = container.querySelector('tbody tr') as HTMLElement;
    const dataTransfer = fakeDataTransfer();

    expect(row).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(row, { dataTransfer });

    expect(onDragFiles).toHaveBeenCalledTimes(1);
    expect(dataTransfer.getData('application/x-ragen-file')).toBe(
      '["file-1","file-2"]',
    );
  });
});

/**
 * Changing a file's PII policy is a deliberate step behind a dialog, the way
 * Delete is — not a select sitting in the row.
 */
describe('UserFilesTable — the PII policy column', () => {
  it('reads the policy rather than offering to change it', () => {
    const { container } = renderTable({ canManageOrg: true });

    expect(container.querySelector('tbody select')).toBeNull();
    expect(container.querySelector('tbody [role="combobox"]')).toBeNull();
  });

  it('puts the change behind the row menu, for someone who may make it', async () => {
    const user = userEvent.setup();
    const onChangeRowPolicy = vi.fn();
    renderTable({ canManageOrg: true, onChangeRowPolicy });

    await user.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    await user.click(
      await screen.findByRole('menuitem', { name: /Change PII policy/i }),
    );

    expect(onChangeRowPolicy).toHaveBeenCalledTimes(1);
  });

  it('leaves the item out entirely when no handler is given', async () => {
    // The wrapper withholds the handler from anyone who may not change the
    // policy, so the item is absent rather than present and disabled — a
    // disabled item in a menu is a promise you cannot keep.
    const user = userEvent.setup();
    renderTable({ canManageOrg: true });

    await user.click(screen.getAllByRole('button', { name: 'Actions' })[0]);

    expect(
      screen.queryByRole('menuitem', { name: /Change PII policy/i }),
    ).toBeNull();
  });
});

/**
 * Every row is 34px, and a wrapped cell is the way that stops being true.
 * `prettyBytes` renders "2.41 MB", which a 76px column could not hold: every
 * file over a megabyte put its unit on a second line and took its row to two.
 */
describe('UserFilesTable — rows keep one height', () => {
  it('does not let the size or the date wrap', () => {
    const { container } = renderTable({
      files: [
        makeFile({ fileSize: 2_410_000, createdAt: new Date('2026-09-12') }),
      ],
    });
    // Name, size, added, status, actions — no selection or policy column here.
    const [, size, added] = Array.from(
      container.querySelectorAll('tbody tr:first-child td'),
    );

    expect(size).toHaveTextContent('2.41 MB');
    expect(size.className).toContain('whitespace-nowrap');
    expect(added.className).toContain('whitespace-nowrap');
  });
});
