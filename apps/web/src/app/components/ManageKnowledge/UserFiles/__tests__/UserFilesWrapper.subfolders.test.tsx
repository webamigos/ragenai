import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import type { PaginatedUserFilesResult } from '@/features/documents/contracts/document.types';

/*
  The table and the grid are stubbed. Both already know what to do with
  folders and no files — `UserFilesTable` and `GridView` have their own tests
  for that — and what is under test here is the gate above them, which used to
  decide the page was empty before either got the chance.
*/
vi.mock('../FileList/DocumentsTableWithFilters', () => ({
  DocumentsTableWithFilters: ({
    subfolders,
  }: {
    subfolders?: { id: string }[];
  }) => (
    <div data-testid="files-table">{`folders:${subfolders?.length ?? 0}`}</div>
  ),
  DocumentsGridWithFilters: ({ children }: React.PropsWithChildren) => (
    <div data-testid="files-grid">{children}</div>
  ),
}));

/* The preview slide-over pulls pdf.js in, which wants a canvas jsdom has not. */
vi.mock('../../DocumentPreview/DocumentPreviewSlideOver', () => ({
  DocumentPreviewSlideOver: () => null,
}));

vi.mock('@/app/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/app/lib/utils/toast', () => ({
  statusToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
    warningToast: vi.fn(),
  }),
}));

vi.mock('@/app/hooks/useUserFilesContext', () => ({
  useUserFilesContext: () => ({
    addFile: vi.fn(),
    removeFile: vi.fn(),
    currentFolderId: 'folder-1',
    viewMode: 'all',
  }),
}));

vi.mock('@/app/hooks/use-auth', () => ({
  useUser: () => ({ user: { id: 'user-1' } }),
  useOrganization: () => ({ canManageOrg: true }),
}));

vi.mock('@/app/hooks/useSettings', () => ({
  useSettings: () => ({ refreshSettings: vi.fn() }),
}));

vi.mock('@/app/hooks/useOrgFeatures', () => ({
  useOrgFeature: () => true,
}));

vi.mock('@/app/actions', () => ({
  deleteFileAction: vi.fn(),
  getPiiIngestionModeAction: vi.fn(async () => 'destructive'),
}));

vi.mock('@/app/actions/folders', () => ({
  getFolderPiiPolicy: vi.fn(async () => 'TOXIC_ONLY'),
}));

vi.mock('@/app/actions/teams', () => ({ getTeams: vi.fn(async () => []) }));

vi.mock('@/app/actions/permissions', () => ({
  getOrgMembersAndTeams: vi.fn(async () => ({ members: [], teams: [] })),
}));

vi.mock('@/app/actions/bulk-documents', () => ({
  bulkDeleteFilesAction: vi.fn(),
  bulkReembedFilesAction: vi.fn(),
  bulkUpdatePiiPolicyAction: vi.fn(),
}));

vi.mock('@/app/lib/services/api', () => ({ uploadFiles: vi.fn() }));

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/knowledge/documents-list',
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import { FileListWrapperWithData } from '../UserFilesWrapper';

const messages = {
  'success-toast': {},
  'error-toast': {},
  'bulk-notifications': {},
  folders: {
    'no-documents': 'No documents in knowledge base',
    'no-documents-in-folder': 'This folder is empty',
    'no-shared-files': 'Nothing shared with you',
    'drag-drop': 'Drag & drop files here',
    'upload-cta': 'Upload file',
    'create-document': 'Create document',
    'add-from-url': 'Add from URL',
    new: 'New folder',
    'add-document': 'Add document',
    'from-disk': 'From disk',
  },
  'files-table': {
    'search-placeholder': 'Search',
  },
  'bulk-action-bar': {
    'aria-label': 'Bulk file operations',
    selected: '{count} selected',
    clear: 'Clear selection',
    delete: 'Delete',
    move: 'Move',
    share: 'Share',
  },
};

const emptyResult: PaginatedUserFilesResult = {
  items: [],
  page: 1,
  pageSize: 25,
  totalCount: 0,
  totalPages: 1,
};

function renderWrapper(subfolders: { id: string; name: string }[]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FileListWrapperWithData
        result={emptyResult}
        sort="createdAt"
        dir="desc"
        selectedFileTypes={[]}
        selectedStatuses={[]}
        selectedPolicies={[]}
        subfolders={
          subfolders as React.ComponentProps<
            typeof FileListWrapperWithData
          >['subfolders']
        }
      />
    </NextIntlClientProvider>,
  );
}

/*
  The folder filter is an exact match, not a subtree: everything filed one
  level down leaves the current folder with no files of its own. Calling that
  empty hid the only rows the page had.
*/
describe('FileListWrapperWithData — a folder holding only folders', () => {
  it('shows the folders instead of the empty state', () => {
    renderWrapper([{ id: 'sub-1', name: '2026' }]);

    expect(screen.getByTestId('files-table')).toHaveTextContent('folders:1');
    expect(screen.queryByText('This folder is empty')).not.toBeInTheDocument();
  });

  it('still shows the empty state when there is nothing at all', () => {
    renderWrapper([]);

    expect(screen.getByText('This folder is empty')).toBeInTheDocument();
    expect(screen.queryByTestId('files-table')).not.toBeInTheDocument();
  });
});
