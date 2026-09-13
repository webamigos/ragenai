import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { Breadcrumbs } from '../Breadcrumbs';

vi.mock('@/app/actions/folders', () => ({
  getFolderBreadcrumbs: vi.fn(),
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import { getFolderBreadcrumbs } from '@/app/actions/folders';

const mockGetFolderBreadcrumbs = vi.mocked(getFolderBreadcrumbs);

const messages = {
  folders: {
    'knowledge-base': 'Knowledge Base',
    'more-folders': 'More folders',
    'breadcrumb-nav': 'Folder navigation',
    'all-files': 'All Files',
    'my-files': 'My Files',
    'shared-with-me': 'Shared with me',
  },
};

function mockDesktop() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, // max-width: 768px → false = desktop
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function mockMobile() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true, // max-width: 768px → true = mobile
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function renderBreadcrumbs(props: {
  folderId: string | null;
  onNavigate?: (id: string | null) => void;
}) {
  const onNavigate = props.onNavigate ?? vi.fn();
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <Breadcrumbs folderId={props.folderId} onNavigate={onNavigate} />
    </NextIntlClientProvider>,
  );
}

describe('Breadcrumbs', () => {
  beforeEach(() => {
    mockDesktop();
    mockGetFolderBreadcrumbs.mockResolvedValue([]);
  });

  /**
   * A trail of one crumb is not a trail: it names the place the page title
   * already names, leads nowhere, and costs a row over the table that phase 7
   * does not have. Inside a folder it does real work — the rail shows where
   * you are, not the way back out.
   */
  it('renders nothing at the root, where there is no trail to show', () => {
    const { container } = renderBreadcrumbs({ folderId: null });

    expect(screen.queryByText('Knowledge Base')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the root crumb inside a folder, as the way back out', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'Folder A' },
    ]);
    renderBreadcrumbs({ folderId: 'f1' });

    await waitFor(() =>
      expect(screen.getByText('Knowledge Base')).toBeInTheDocument(),
    );
  });

  it('renders single segment without overflow', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'Folder A' },
    ]);
    renderBreadcrumbs({ folderId: 'f1' });
    await waitFor(() =>
      expect(screen.getByText('Folder A')).toBeInTheDocument(),
    );
    expect(screen.queryByText('...')).not.toBeInTheDocument();
  });

  it('renders 4 segments on desktop without overflow', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'A' },
      { id: 'f2', name: 'B' },
      { id: 'f3', name: 'C' },
      { id: 'f4', name: 'D' },
    ]);
    renderBreadcrumbs({ folderId: 'f4' });
    await waitFor(() => expect(screen.getByText('D')).toBeInTheDocument());
    expect(screen.queryByText('...')).not.toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('truncates on desktop when more than 4 segments', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'A' },
      { id: 'f2', name: 'B' },
      { id: 'f3', name: 'C' },
      { id: 'f4', name: 'D' },
      { id: 'f5', name: 'E' },
      { id: 'f6', name: 'F' },
    ]);
    renderBreadcrumbs({ folderId: 'f6' });
    await waitFor(() => expect(screen.getByText('...')).toBeInTheDocument());
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
    expect(screen.getByText('F')).toBeInTheDocument();
  });

  it('truncates on mobile when more than 1 visible segment', async () => {
    mockMobile();
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'A' },
      { id: 'f2', name: 'B' },
      { id: 'f3', name: 'C' },
    ]);
    renderBreadcrumbs({ folderId: 'f3' });
    await waitFor(() => expect(screen.getByText('...')).toBeInTheDocument());
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('shows hidden segments in overflow dropdown on click', async () => {
    const user = userEvent.setup();
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'A' },
      { id: 'f2', name: 'B' },
      { id: 'f3', name: 'C' },
      { id: 'f4', name: 'D' },
      { id: 'f5', name: 'E' },
    ]);
    renderBreadcrumbs({ folderId: 'f5' });
    await waitFor(() => expect(screen.getByText('...')).toBeInTheDocument());
    await user.click(screen.getByText('...'));
    expect(await screen.findByText('A')).toBeInTheDocument();
  });

  it('calls onNavigate with folder id when clicking a segment', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'A' },
      { id: 'f2', name: 'B' },
    ]);
    renderBreadcrumbs({ folderId: 'f2', onNavigate });
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    await user.click(screen.getByText('A'));
    expect(onNavigate).toHaveBeenCalledWith('f1');
  });

  it('last segment is not a button', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'A' },
      { id: 'f2', name: 'Last' },
    ]);
    renderBreadcrumbs({ folderId: 'f2' });
    await waitFor(() => expect(screen.getByText('Last')).toBeInTheDocument());
    const lastEl = screen.getByText('Last');
    expect(lastEl.tagName).not.toBe('BUTTON');
  });

  it('calls onNavigate with null when clicking home', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    mockGetFolderBreadcrumbs.mockResolvedValue([{ id: 'f1', name: 'A' }]);
    renderBreadcrumbs({ folderId: 'f1', onNavigate });
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    await user.click(screen.getByText('Knowledge Base'));
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('remains stable when getFolderBreadcrumbs rejects', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValueOnce([
      { id: 'f1', name: 'Folder A' },
    ]);
    const { rerender } = renderBreadcrumbs({ folderId: 'f1' });
    await waitFor(() =>
      expect(screen.getByText('Folder A')).toBeInTheDocument(),
    );

    mockGetFolderBreadcrumbs.mockRejectedValue(new Error('Network error'));
    rerender(
      <NextIntlClientProvider messages={messages} locale="en">
        <Breadcrumbs folderId="f2" onNavigate={vi.fn()} />
      </NextIntlClientProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByText('Folder A')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Knowledge Base')).toBeInTheDocument();
  });

  it('marks last segment with aria-current="page"', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'A' },
      { id: 'f2', name: 'Last' },
    ]);
    renderBreadcrumbs({ folderId: 'f2' });
    await waitFor(() => expect(screen.getByText('Last')).toBeInTheDocument());
    expect(screen.getByText('Last')).toHaveAttribute('aria-current', 'page');
  });
});

/**
 * The trail standing in for the page's heading.
 *
 * A folder page used to carry two horizontal bands saying where you are: a
 * heading naming the scope ("All files") and, under it, a breadcrumb naming
 * the folder you were actually in. Only one of them answered the question.
 */
describe('Breadcrumbs — as the page title', () => {
  beforeEach(() => {
    mockDesktop();
    mockGetFolderBreadcrumbs.mockResolvedValue([]);
  });

  function renderTitle(folderId: string, onNavigate = vi.fn()) {
    render(
      <NextIntlClientProvider messages={messages} locale="en">
        <Breadcrumbs
          folderId={folderId}
          onNavigate={onNavigate}
          variant="title"
          rootLabel="All Files"
        />
      </NextIntlClientProvider>,
    );
    return { onNavigate };
  }

  it('makes the folder you are in the page heading', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'Contracts' },
      { id: 'f2', name: '2026' },
    ]);
    renderTitle('f2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        '2026',
      ),
    );
    // The path in front of it is still the way back out.
    expect(screen.getByRole('button', { name: 'Contracts' })).toBeVisible();
  });

  it('calls the root by the active scope, so the trail and the rail agree', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'Contracts' },
    ]);
    renderTitle('f1');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /All Files/ })).toBeVisible(),
    );
    // Not "Knowledge Base" — the rail says "All Files", and two names for the
    // same place is one name too many.
    expect(screen.queryByText('Knowledge Base')).not.toBeInTheDocument();
  });

  it('has a heading from the first paint, before the crumbs arrive', () => {
    // The trail is a round trip away. Until it lands the root *is* the place
    // you are standing in, so it takes the h1 rather than leaving the page
    // without one.
    mockGetFolderBreadcrumbs.mockReturnValue(new Promise(() => {}));
    renderTitle('f2');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'All Files',
    );
  });

  /*
    Below `lg` the folder rail is hidden, so the trail is the only way back
    out of a folder. A heading that is only a heading would make a failed
    fetch a dead end.
  */
  it('leaves the root clickable when the trail never arrives', async () => {
    const user = userEvent.setup();
    mockGetFolderBreadcrumbs.mockRejectedValue(new Error('Network error'));
    const { onNavigate } = renderTitle('f2');

    const root = await screen.findByRole('button', { name: /All Files/ });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'All Files',
    );

    await user.click(root);
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('does not offer the root as a link while the trail is still loading', () => {
    mockGetFolderBreadcrumbs.mockReturnValue(new Promise(() => {}));
    renderTitle('f2');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'All Files',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('leaves exactly one h1 on the page once the trail lands', async () => {
    mockGetFolderBreadcrumbs.mockResolvedValue([
      { id: 'f1', name: 'Contracts' },
      { id: 'f2', name: '2026' },
    ]);
    renderTitle('f2');

    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1),
    );
  });
});
