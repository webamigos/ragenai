import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { UserFilesTable } from '../UserFilesTable';
import type { UserFileTypeSafe } from '../UserFilesTable';
import { EmbeddingStatus } from '@/generated/prisma/browser';
import type {
  UserFilesSort,
  UserFilesSortDir,
} from '@/features/documents/contracts/document.types';

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
}));

vi.mock('@/app/[locale]/(panel)/knowledge/optimize-document/actions', () => ({
  scoreDocumentAction: vi.fn().mockResolvedValue({ total: 80 }),
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
  'pii-policy': {
    label: 'PII Masking Policy',
    'select-label': 'PII masking policy',
    'none-label': 'None',
    'none-description': 'No masking',
    'toxic-only-label': 'Toxic only',
    'toxic-only-description': 'Masks toxic PII',
    'strict-label': 'Strict',
    'strict-description': 'Masks all PII',
    'badge-none': 'No masking',
    'badge-toxic-only': 'Toxic only',
    'badge-strict': 'Strict',
  },
};

const makeFile = (
  overrides: Partial<UserFileTypeSafe> = {},
): UserFileTypeSafe => ({
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
});

const defaultProps = {
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

function renderTable(
  props: Partial<typeof defaultProps> & { onSort?: (col: string) => void } = {},
) {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <UserFilesTable {...defaultProps} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('UserFilesTable — sortowalne nagłówki', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renderuje przyciski wewnątrz nagłówków fileName, fileSize i createdAt', () => {
    renderTable();
    expect(
      screen.getByTestId('sort-header-fileName').querySelector('button'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('sort-header-fileSize').querySelector('button'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('sort-header-createdAt').querySelector('button'),
    ).toBeInTheDocument();
  });

  it('przyciski mają type="button"', () => {
    renderTable();
    const btn = screen
      .getByTestId('sort-header-fileName')
      .querySelector('button');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('wywołuje onSort po kliknięciu nagłówka fileName', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderTable({ onSort });
    await user.click(
      screen.getByTestId('sort-header-fileName').querySelector('button')!,
    );
    expect(onSort).toHaveBeenCalledWith('fileName');
  });

  it('wywołuje onSort po kliknięciu nagłówka fileSize', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderTable({ onSort });
    await user.click(
      screen.getByTestId('sort-header-fileSize').querySelector('button')!,
    );
    expect(onSort).toHaveBeenCalledWith('fileSize');
  });

  it('wywołuje onSort po kliknięciu nagłówka createdAt', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderTable({ onSort });
    await user.click(
      screen.getByTestId('sort-header-createdAt').querySelector('button')!,
    );
    expect(onSort).toHaveBeenCalledWith('createdAt');
  });

  it('nagłówek aktywnej kolumny ma aria-sort="ascending" gdy dir=asc', () => {
    renderTable({ sort: 'fileName' as const, dir: 'asc' as const });
    expect(screen.getByTestId('sort-header-fileName')).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('nagłówek aktywnej kolumny ma aria-sort="descending" gdy dir=desc', () => {
    renderTable({ sort: 'fileName' as const, dir: 'desc' as const });
    expect(screen.getByTestId('sort-header-fileName')).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('nieaktywne nagłówki mają aria-sort="none"', () => {
    renderTable({ sort: 'fileName' as const, dir: 'asc' as const });
    expect(screen.getByTestId('sort-header-fileSize')).toHaveAttribute(
      'aria-sort',
      'none',
    );
    expect(screen.getByTestId('sort-header-createdAt')).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('SortIcon jest renderowany wewnątrz przycisku', () => {
    const SortIcon = ({ column }: { column: string }) => (
      <span data-testid={`icon-${column}`}>▲</span>
    );
    renderTable({ SortIcon } as Parameters<typeof renderTable>[0]);
    expect(screen.getByTestId('sort-icon-fileName')).toBeInTheDocument();
    expect(screen.getByTestId('sort-icon-fileSize')).toBeInTheDocument();
    expect(screen.getByTestId('sort-icon-createdAt')).toBeInTheDocument();
  });

  it('przycisk jest wyłączony gdy onSort nie jest podany', () => {
    renderTable();
    const btn = screen
      .getByTestId('sort-header-fileName')
      .querySelector('button');
    expect(btn).toBeDisabled();
  });

  it('przyciski są dostępne klawiaturowo (focusable)', () => {
    const onSort = vi.fn();
    renderTable({ onSort });
    const btn = screen
      .getByTestId('sort-header-fileName')
      .querySelector('button')!;
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });
});

describe('UserFilesTable — canManageOrg prop', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('wyświetla nagłówek kolumny PII Policy gdy canManageOrg=true', () => {
    renderTable({ canManageOrg: true } as Parameters<typeof renderTable>[0]);
    expect(screen.getByTestId('pii-policy-column-header')).toBeInTheDocument();
  });

  it('nie wyświetla nagłówka kolumny PII Policy gdy canManageOrg nie jest podany', () => {
    renderTable();
    expect(
      screen.queryByTestId('pii-policy-column-header'),
    ).not.toBeInTheDocument();
  });

  it('nie wyświetla nagłówka kolumny PII Policy gdy canManageOrg=false', () => {
    renderTable({ canManageOrg: false } as Parameters<typeof renderTable>[0]);
    expect(
      screen.queryByTestId('pii-policy-column-header'),
    ).not.toBeInTheDocument();
  });

  /**
   * The column reads the policy; it does not offer to change it.
   *
   * It used to hold a live select, so a data-protection setting could change
   * from a stray click in a menu nobody meant to open — no confirmation, and
   * nothing said about the text already indexed under the old policy.
   * Changing it is an item in the row's menu now, behind a dialog.
   */
  it('shows the policy as a badge, not as a control', () => {
    const fileWithPolicy = makeFile({
      piiPolicy: 'STRICT',
    } as Partial<UserFileTypeSafe>);
    const { container } = renderTable({
      files: [fileWithPolicy],
      canManageOrg: true,
    } as Parameters<typeof renderTable>[0]);

    expect(screen.getByTestId('pii-policy-badge-strict')).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: /pii masking policy/i }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('tbody select')).toBeNull();
  });
});
