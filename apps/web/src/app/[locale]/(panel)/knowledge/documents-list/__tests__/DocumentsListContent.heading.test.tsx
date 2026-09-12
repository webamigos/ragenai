import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import type { PaginatedUserFilesResult } from '@/features/documents/contracts/document.types';

/*
  Everything below the heading is stubbed. The table, the rail and the
  breadcrumbs each pull in server actions, Temporal and the whole file toolbar;
  what is under test is the one line that says what the scope holds.
*/
vi.mock('@/app/components/ManageKnowledge/UserFiles/UserFilesWrapper', () => ({
  FileListWrapperWithData: ({ heading }: { heading?: React.ReactNode }) => (
    <div>{heading}</div>
  ),
}));

vi.mock('@/app/components/ManageKnowledge/Folders/FoldersList', () => ({
  FoldersList: () => <div data-testid="rail" />,
}));

vi.mock('@/app/components/ManageKnowledge/Breadcrumbs', () => ({
  Breadcrumbs: () => <div data-testid="breadcrumbs" />,
}));

const mockViewMode = vi.hoisted(() => ({ current: 'all' as string }));
vi.mock('@/app/hooks/useUserFilesContext', () => ({
  useUserFilesContext: () => ({
    currentFolderId: null,
    viewMode: mockViewMode.current,
    setFolder: vi.fn(),
    setViewMode: vi.fn(),
  }),
}));

vi.mock('@/app/hooks/use-auth', () => ({
  useOrganization: () => ({ canManageOrg: true }),
}));

vi.mock('@/app/actions/folders', () => ({ getFolders: vi.fn(async () => []) }));

/*
  The drop-a-file-on-a-folder handler brings the bulk move action and the
  toasts in with it, and the toast module reaches the server/client logger
  split that does not resolve under vitest.
*/
vi.mock('@/app/actions/bulk-documents', () => ({
  bulkMoveFilesToFolderAction: vi.fn(async () => ({
    succeeded: [],
    failed: [],
  })),
}));

vi.mock('@/app/lib/utils/toast', () => ({
  statusToast: () => ({ successToast: vi.fn(), errorToast: vi.fn() }),
}));

vi.mock('../../actions', () => ({
  getKnowledgeBaseUsage: vi.fn(async () => null),
}));

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/knowledge/documents-list',
}));

import { DocumentsListContent } from '../DocumentsListContent';

const messages = {
  folders: {
    'all-files': 'All files',
    'my-files': 'My files',
    'shared-with-me': 'Shared with me',
    'document-count': '{count, plural, one {# document} other {# documents}}',
    'scope-summary':
      '{documents, plural, one {# document} other {# documents}} · ~{pages, plural, one {# page} other {# pages}}',
  },
};

const result: PaginatedUserFilesResult = {
  items: [],
  page: 1,
  pageSize: 25,
  totalCount: 0,
  totalPages: 1,
};

function renderContent(
  scopeCounts: Record<string, { files: number; pages: number }>,
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DocumentsListContent
        result={result}
        scopeCounts={
          scopeCounts as React.ComponentProps<
            typeof DocumentsListContent
          >['scopeCounts']
        }
        sort="createdAt"
        dir="desc"
        selectedFileTypes={[]}
        selectedStatuses={[]}
        selectedPolicies={[]}
      />
    </NextIntlClientProvider>,
  );
}

const counts = (files: number, pages: number) => ({
  all: { files, pages },
  'my-files': { files: 0, pages: 0 },
  'shared-with-me': { files: 0, pages: 0 },
});

describe('DocumentsListContent — the scope heading', () => {
  it('says how many documents and, approximately, how many pages', () => {
    renderContent(counts(240, 4812));

    expect(
      screen.getByText('240 documents · ~4,812 pages'),
    ).toBeInTheDocument();
  });

  /**
   * The tilde is not decoration. A page total sums files whose counts come
   * from two places — Docling's real count, and `ceil(chars / 3000)` for the
   * formats that have no pages — so one estimated file makes the whole sum an
   * estimate. The usage block in the rail carries the same mark.
   */
  it('marks the page total as approximate', () => {
    renderContent(counts(3, 40));

    expect(screen.getByText(/~40 pages/)).toBeInTheDocument();
  });

  /**
   * Nothing indexed yet is not "about zero pages". At that point the document
   * count already says the place is empty, and "· ~0 pages" is only noise.
   */
  it('drops the page total when nothing has been indexed', () => {
    renderContent(counts(2, 0));

    expect(screen.getByText('2 documents')).toBeInTheDocument();
    expect(screen.queryByText(/pages/)).not.toBeInTheDocument();
  });

  it('describes the scope the rail has active, not the whole organization', () => {
    mockViewMode.current = 'my-files';
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DocumentsListContent
          result={result}
          scopeCounts={
            {
              all: { files: 240, pages: 4812 },
              'my-files': { files: 38, pages: 700 },
              'shared-with-me': { files: 14, pages: 120 },
            } as React.ComponentProps<
              typeof DocumentsListContent
            >['scopeCounts']
          }
          sort="createdAt"
          dir="desc"
          selectedFileTypes={[]}
          selectedStatuses={[]}
          selectedPolicies={[]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('My files')).toBeInTheDocument();
    expect(screen.getByText('38 documents · ~700 pages')).toBeInTheDocument();
    mockViewMode.current = 'all';
  });
});
