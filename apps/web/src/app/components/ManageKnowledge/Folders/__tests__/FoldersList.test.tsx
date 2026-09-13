import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { FoldersList } from '../FoldersList';
import type { DocumentFolderItem } from '@/features/documents/contracts/document.types';

vi.mock('@ragenai/common-ui/Tooltip', () => ({
  Tooltip: ({
    children,
    content,
  }: React.PropsWithChildren<{ content: string }>) => (
    <span data-tooltip-content={content}>{children}</span>
  ),
}));

vi.mock('@/app/actions/folders', () => ({
  getFolders: vi.fn().mockResolvedValue([]),
  deleteFolder: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/app/lib/utils/toast', () => ({
  statusToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const messages = {
  folders: {
    'all-files': 'All Files',
    'my-files': 'My Files',
    'shared-with-me': 'Shared with me',
    usage: 'Usage',
    storage: 'Storage',
    'storage-of': '{used} / {limit}',
    pages: 'Pages',
    scope: 'Scope',
    title: 'Folders',
    edit: 'Edit',
    delete: 'Delete',
    'delete-title': 'Delete {folderName}',
    'delete-confirm-with-files': 'Delete {count} files?',
    'delete-confirm-empty': 'Delete empty folder?',
    cancel: 'Cancel',
    deleting: 'Deleting...',
    'folder-deleted': 'Folder deleted',
    'failed-to-delete': 'Failed to delete',
    'edit-title': 'Edit Folder',
    'folder-name-label': 'Folder Name',
    'pii-policy-hint': 'hint',
    'folder-updated': 'Folder updated',
    'failed-to-update': 'Failed to update folder',
    save: 'Save',
    saving: 'Saving...',
    'reembed-confirm-title': 'Re-process files?',
    'reembed-confirm-body': 'body',
    'reembed-confirm-action': 'Re-process',
    'reembed-success': 'Processed {succeeded} of {total} files',
    'reembed-partial':
      'Processed {succeeded} of {total} files ({failed} errors)',
    'reembed-empty': 'No files to process',
    'apply-to-subfolders': 'Apply to subfolders',
    'apply-to-subfolders-hint': 'hint',
  },
  'pii-policy': {
    'badge-none': 'No masking',
    'badge-toxic-only': 'Sensitive data',
    'badge-strict': 'All personal data',
    'tag-none': 'None',
    'tag-toxic-only': 'Sensitive',
    'tag-strict': 'All PII',
    'none-label': 'None',
    'none-description': 'No masking',
    'toxic-only-label': 'Toxic only',
    'toxic-only-description': 'Mask toxic content',
    'strict-label': 'Strict',
    'strict-description': 'Mask all PII',
    'select-label': 'PII Policy',
    label: 'PII Masking Policy',
  },
};

function makeFolder(
  overrides: Partial<DocumentFolderItem> = {},
): DocumentFolderItem {
  return {
    id: 'folder-1',
    name: 'Test Folder',
    teamId: null,
    teamName: null,
    parentId: null,
    path: '/',
    ownerId: null,
    ownerName: null,
    fileCount: 0,
    piiPolicy: 'TOXIC_ONLY',
    ...overrides,
  };
}

function renderList(
  folders: DocumentFolderItem[],
  props: Partial<React.ComponentProps<typeof FoldersList>> = {},
) {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <FoldersList initialFolders={folders} {...props} />
    </NextIntlClientProvider>,
  );
}

/**
 * The rail used to encode the policy as the colour of a shield icon, with the
 * name only in a tooltip. Two folders on different policies then read the same
 * to anyone who cannot separate crimson from amber, and identically to a
 * screen reader — panel rule 26. These assert the word, not the tint.
 */
describe('folder PII policy tag', () => {
  it('names the policy for NONE', () => {
    renderList([makeFolder({ piiPolicy: 'NONE' })]);
    expect(screen.getByText('Test Folder')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('names the policy for TOXIC_ONLY', () => {
    renderList([makeFolder({ piiPolicy: 'TOXIC_ONLY' })]);
    expect(screen.getByText('Sensitive')).toBeInTheDocument();
  });

  it('names the policy for STRICT', () => {
    renderList([makeFolder({ piiPolicy: 'STRICT' })]);
    expect(screen.getByText('All PII')).toBeInTheDocument();
  });

  /**
   * The short label is what fits the rail; the exact policy name still has to
   * reach anyone who cannot read a tint, which is the whole reason this
   * stopped being a coloured shield.
   */
  it('carries the full policy name for a screen reader', () => {
    renderList([makeFolder({ piiPolicy: 'STRICT' })]);
    expect(screen.getByText('All personal data')).toHaveClass('sr-only');
  });

  /**
   * `null` is a state the data can actually be in now. The column was NOT NULL
   * with a default of TOXIC_ONLY until the override migration, so this case
   * was reachable in a fixture and nowhere else — every real folder carried a
   * policy, and therefore a tag, and in a 216px rail the tag was taking the
   * room the folder's name needed.
   */
  it('renders no tag when the folder does not override the default', () => {
    renderList([makeFolder({ piiPolicy: null })]);
    expect(screen.queryByText('None')).not.toBeInTheDocument();
    expect(screen.queryByText('Sensitive')).not.toBeInTheDocument();
    expect(screen.queryByText('All PII')).not.toBeInTheDocument();
  });

  /** And the name gets the space back: no tag, nothing truncating it. */
  it('gives an untagged folder the whole row for its name', () => {
    renderList([
      makeFolder({ name: 'Product docs', piiPolicy: null }),
      makeFolder({ id: 'f2', name: 'HR / Payroll', piiPolicy: 'STRICT' }),
    ]);

    expect(screen.getByText('Product docs')).toBeInTheDocument();
    expect(screen.getAllByText('All PII')).toHaveLength(1);
  });

  /**
   * The row is a `<button>`, and the UA stylesheet centres a button's text.
   * It did not show while the name span sat beside a tag taking most of the
   * row; with the tag gone the name drifted into the middle of the rail.
   */
  it('keeps the folder name against its icon rather than centred', () => {
    renderList([makeFolder({ name: 'Contracts', piiPolicy: null })]);

    const row = screen.getByText('Contracts').closest('button')!;
    expect(row.className).toContain('text-left');
  });
});

describe('scope counts', () => {
  it('renders a count beside each scope', () => {
    renderList([], {
      scopeCounts: {
        all: { files: 240, pages: 4812 },
        'my-files': { files: 38, pages: 700 },
        'shared-with-me': { files: 14, pages: 120 },
      },
    });

    expect(screen.getByText('240')).toBeInTheDocument();
    expect(screen.getByText('38')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  /**
   * A count is fetched on the server and arrives after the first paint. Zero
   * and "not known yet" are different facts, and rendering the second as the
   * first tells someone their shared files are gone.
   */
  it('renders no count at all while the counts are unknown', () => {
    const { container } = renderList([], { scopeCounts: null });

    expect(container.querySelector('.tabular-nums')).toBeNull();
  });

  it('renders a zero, because zero is a count', () => {
    renderList([], {
      scopeCounts: {
        all: { files: 0, pages: 0 },
        'my-files': { files: 0, pages: 0 },
        'shared-with-me': { files: 0, pages: 0 },
      },
    });

    expect(screen.getAllByText('0')).toHaveLength(3);
  });
});

describe('usage block', () => {
  const usage = {
    totalBytes: 2_000_000,
    limitBytes: 8_000_000,
    pageCount: 4812,
  };

  it('plots the bar against the allowance and states both figures', () => {
    renderList([], { usage });

    const bar = screen.getByRole('progressbar', { name: 'Storage' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('2 MB / 8 MB')).toBeInTheDocument();
  });

  /**
   * A limit of zero is "not configured", and dividing by it yields `Infinity`
   * — a full bar claiming the organization is out of space.
   */
  it('does not fill the bar when no allowance is set', () => {
    renderList([], { usage: { ...usage, limitBytes: 0 } });

    expect(
      screen.getByRole('progressbar', { name: 'Storage' }),
    ).toHaveAttribute('aria-valuenow', '0');
  });

  it('never overflows the bar when the allowance is already passed', () => {
    renderList([], { usage: { ...usage, totalBytes: 99_000_000 } });

    expect(
      screen.getByRole('progressbar', { name: 'Storage' }),
    ).toHaveAttribute('aria-valuenow', '100');
  });
});

/**
 * The rail is where a move lands, because it is the only place on the page
 * showing every folder at once — including the ones you are not standing in.
 */
describe('dropping files onto a folder', () => {
  const RAGEN_TYPE = 'application/x-ragen-file';

  function fileDrag(ids: string[] = ['file-1']) {
    return {
      types: [RAGEN_TYPE],
      dropEffect: '',
      getData: (type: string) =>
        type === RAGEN_TYPE ? JSON.stringify(ids) : '',
    };
  }

  const folderRow = () => screen.getByRole('button', { name: /Test Folder/ });
  const allFilesRow = () => screen.getByRole('button', { name: /All Files/ });

  it('files the dropped documents into the folder they landed on', () => {
    const onDropFiles = vi.fn();
    renderList([makeFolder()], { onDropFiles });

    fireEvent.drop(folderRow(), { dataTransfer: fileDrag(['a', 'b']) });

    expect(onDropFiles).toHaveBeenCalledWith('folder-1', ['a', 'b']);
  });

  it('takes a document out of its folder when dropped on All files', () => {
    // The one-gesture route back to unfiled. The row menu's Move opens a
    // dialog; there is nothing else that clears a folder in a single move.
    const onDropFiles = vi.fn();
    renderList([makeFolder()], { onDropFiles });

    fireEvent.drop(allFilesRow(), { dataTransfer: fileDrag(['a']) });

    expect(onDropFiles).toHaveBeenCalledWith(null, ['a']);
  });

  it('marks the row a move would land on, and only that row', () => {
    renderList([makeFolder()], { onDropFiles: vi.fn() });

    fireEvent.dragOver(folderRow(), { dataTransfer: fileDrag() });

    expect(folderRow().className).toContain('bg-brand-50');
    expect(allFilesRow().className).not.toContain('bg-brand-50');
  });

  it('ignores a file arriving from the desktop — that is an upload, not a move', () => {
    const onDropFiles = vi.fn();
    renderList([makeFolder()], { onDropFiles });
    const osDrag = { types: ['Files'], dropEffect: '', getData: () => '' };

    fireEvent.dragOver(folderRow(), { dataTransfer: osDrag });
    expect(folderRow().className).not.toContain('bg-brand-50');

    fireEvent.drop(folderRow(), { dataTransfer: osDrag });
    expect(onDropFiles).not.toHaveBeenCalled();
  });

  it('does nothing on a drop that carries no ids', () => {
    const onDropFiles = vi.fn();
    renderList([makeFolder()], { onDropFiles });

    fireEvent.drop(folderRow(), { dataTransfer: fileDrag([]) });

    expect(onDropFiles).not.toHaveBeenCalled();
  });

  it('is inert when the page is not listening for moves', () => {
    renderList([makeFolder()]);

    fireEvent.dragOver(folderRow(), { dataTransfer: fileDrag() });

    expect(folderRow().className).not.toContain('bg-brand-50');
  });
});
