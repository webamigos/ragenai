import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { GridView } from '../GridView';
import type { DocumentFolderItem } from '@/features/documents/contracts/document.types';

vi.mock('@/app/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/pl/knowledge/documents-list',
  Link: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = {
  folders: {
    'file-count': '{count, plural, one {# file} other {# files}}',
    'no-documents': 'No documents',
    'drag-drop': 'Drag and drop',
    'upload-cta': 'Upload',
    'create-document': 'Create document',
    'add-from-url': 'Add from URL',
  },
  'bulk-action-bar': { 'select-all': 'Select all' },
  'files-table': { 'no-files': 'No files' },
  'admin-panel-page': { 'fetching-error': 'Could not load files' },
};

const FOLDERS: DocumentFolderItem[] = [
  {
    id: 'folder-2026',
    name: '2026',
    parentId: 'folder-contracts',
    fileCount: 2,
  } as DocumentFolderItem,
];

function show(subfolders: DocumentFolderItem[], onNavigateFolder = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GridView
        files={[]}
        subfolders={subfolders}
        onNavigateFolder={onNavigateFolder}
        isLoading={false}
        isError={false}
        showModal={{ isOpen: false, fileId: null }}
        deleteLoading={false}
        toggleModal={vi.fn()}
        addFile={vi.fn()}
        removeFile={vi.fn()}
        handleDelete={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return { onNavigateFolder };
}

/**
 * The grid could always draw folder tiles; it was handed `subfolders={[]}`
 * hard-coded, so it never did. The folder filter is an exact match rather
 * than a subtree, so a subfolder's files were invisible from the content area
 * and the rail was the only way down.
 */
describe('GridView — subfolders', () => {
  it('draws the folders inside the one you are looking at', () => {
    show(FOLDERS);

    expect(screen.getByRole('button', { name: /2026/ })).toBeVisible();
    expect(screen.getByText('2 files')).toBeVisible();
  });

  it('opens the folder when its tile is clicked', async () => {
    const user = userEvent.setup();
    const { onNavigateFolder } = show(FOLDERS);

    await user.click(screen.getByRole('button', { name: /2026/ }));

    expect(onNavigateFolder).toHaveBeenCalledWith('folder-2026');
  });

  it('shows the empty state, not a bare grid, when there is nothing at all', () => {
    show([]);

    expect(screen.queryByRole('button', { name: /2026/ })).toBeNull();
    expect(screen.getByText('No documents')).toBeVisible();
  });
});
