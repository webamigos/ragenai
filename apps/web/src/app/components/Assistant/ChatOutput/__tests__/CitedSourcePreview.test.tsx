import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';

import messages from '@/app/messages/en.json';

/**
 * The panel behind a citation.
 *
 * The viewer itself is mocked: it is loaded with `next/dynamic` precisely so
 * pdf.js stays out of the chat bundle until a reader opens a source, and pulling
 * it into jsdom would defeat both the point and the test — pdf.js reaches for
 * `DOMMatrix` at module scope. What is asserted here is the wiring: which file
 * is opened, at which page, with which rectangles, and how the panel closes.
 */
const viewerSpy = vi.hoisted(() => vi.fn());

vi.mock('next/dynamic', () => ({
  default: () => (props: Record<string, unknown>) => {
    viewerSpy(props);
    return <div data-testid="viewer" />;
  },
}));

import { CitedSourcePreview } from '../CitedSourcePreview';
import type { RetrievalSource } from '@/store/assistant/assistantSlice';

const show = (source: RetrievalSource | null, onClose = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CitedSourcePreview source={source} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
};

const source = (overrides: Partial<RetrievalSource> = {}): RetrievalSource => ({
  fileId: 'file-a',
  fileName: 'umowa.pdf',
  chunkCount: 1,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CitedSourcePreview', () => {
  it('renders nothing until a source is picked', () => {
    show(null);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(viewerSpy).not.toHaveBeenCalled();
  });

  it('opens the file the citation points at, through the guarded route', () => {
    // `/api/files/{id}` already checks tenancy and authorization as two
    // separate conditions. This panel adds no read path of its own, which is
    // why it can show a document it knows nothing about beyond an id.
    show(source());

    expect(viewerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file-a',
        contentUrl: '/api/files/file-a',
      }),
    );
  });

  it('opens at the page the quoted chunk came from', () => {
    show(source({ sourcePage: 7 }));

    expect(viewerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ initialPage: 7 }),
    );
  });

  it('highlights the regions of the chunk the answer read', () => {
    const regions = [{ page: 7, x: 0.05, y: 0.2, w: 0.9, h: 0.06 }];
    show(source({ sourcePage: 7, sourceRegions: regions }));

    expect(viewerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ highlights: regions }),
    );
  });

  it('opens at the beginning when the parser knew no page', () => {
    // Every legacy loader and every unpaginated format. Defaulting to 1 here
    // would be indistinguishable from a real page 1, which is the whole reason
    // `sourcePage` is absent rather than zero upstream.
    show(source());

    expect(viewerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ initialPage: undefined }),
    );
  });

  it.each([0, 1.5, -3, Number.POSITIVE_INFINITY])(
    'refuses %s as a page rather than passing it to the viewer',
    (page) => {
      // The value arrived over the network. A component should not place a
      // view using a number it cannot justify because something upstream
      // promised not to send one — the same check the source card makes.
      show(source({ sourcePage: page }));

      expect(viewerSpy).toHaveBeenCalledWith(
        expect.objectContaining({ initialPage: undefined }),
      );
    },
  );

  it('picks the viewer from the file name, since a chunk carries no type', () => {
    show(source({ fileName: 'notatki.md' }));

    expect(viewerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ fileType: 'MARKDOWN' }),
    );
  });

  it('falls back to the id when the file name was never stored', () => {
    show(source({ fileName: null }));

    expect(screen.getByRole('dialog')).toHaveAccessibleName('file-a');
    expect(viewerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ fileType: 'UNKNOWN', fileName: 'file-a' }),
    );
  });

  it('names the panel after the document', () => {
    show(source());

    expect(screen.getByRole('dialog')).toHaveAccessibleName('umowa.pdf');
  });

  it('closes on the close button', async () => {
    const onClose = show(source());

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the overlay', async () => {
    const onClose = show(source());

    await userEvent.click(screen.getByTestId('cited-source-overlay'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = show(source());

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not listen for Escape while it is closed', async () => {
    // The panel is mounted under every answer in the thread. A listener per
    // closed panel would mean one Escape firing `onClose` for every turn on
    // screen.
    const onClose = show(null);

    await userEvent.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Keyboard access to the panel.
 *
 * `role="dialog"` and `aria-modal="true"` describe the panel to a screen
 * reader; neither moves focus and neither changes the Tab order. Without the
 * three behaviours below, a keyboard user activates a source card, and focus
 * stays on the card behind the scrim — Tab then walks the thread underneath,
 * where every control is live and nothing says they have left the dialog.
 */
describe('CitedSourcePreview — keyboard access', () => {
  /** A card to open the panel from, so focus has somewhere to go back to. */
  const withTrigger = (onClose = vi.fn()) => {
    const utils = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <>
          <button type="button">Open umowa.pdf</button>
          <CitedSourcePreview source={null} onClose={onClose} />
        </>
      </NextIntlClientProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Open umowa.pdf' });
    trigger.focus();
    const open = () =>
      utils.rerender(
        <NextIntlClientProvider locale="en" messages={messages}>
          <>
            <button type="button">Open umowa.pdf</button>
            <CitedSourcePreview source={source()} onClose={onClose} />
          </>
        </NextIntlClientProvider>,
      );
    const close = () =>
      utils.rerender(
        <NextIntlClientProvider locale="en" messages={messages}>
          <>
            <button type="button">Open umowa.pdf</button>
            <CitedSourcePreview source={null} onClose={onClose} />
          </>
        </NextIntlClientProvider>,
      );
    return { trigger, open, close };
  };

  it('moves focus into the panel when it opens', () => {
    const { trigger, open } = withTrigger();
    expect(document.activeElement).toBe(trigger);

    open();

    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('hands focus back to the card that opened it', () => {
    const { trigger, open, close } = withTrigger();
    open();
    expect(document.activeElement).not.toBe(trigger);

    close();

    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab from the last control back to the first', async () => {
    const { open } = withTrigger();
    open();
    const dialog = screen.getByRole('dialog');
    const closeButton = within(dialog).getByRole('button', { name: 'Close' });
    closeButton.focus();

    await userEvent.tab();

    // The close button is the only Tab stop the mocked viewer leaves, so
    // wrapping lands back on it rather than escaping to the page behind.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('wraps Shift+Tab from the panel to the last control', async () => {
    const { open } = withTrigger();
    open();
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);

    await userEvent.tab({ shift: true });

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Close' }),
    );
  });

  it('never lets Tab reach the thread behind the scrim', async () => {
    const { trigger, open } = withTrigger();
    open();
    const dialog = screen.getByRole('dialog');

    for (let i = 0; i < 5; i += 1) {
      await userEvent.tab();
      expect(document.activeElement).not.toBe(trigger);
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('is the panel that carries the dialog role, not the scrim', () => {
    // The scrim is chrome. Inside the dialog, a screen reader announces it as
    // the dialog's first child — a clickable nothing.
    const { open } = withTrigger();
    open();

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(screen.getByTestId('cited-source-overlay'))).toBe(
      false,
    );
    expect(dialog).toHaveAccessibleName('umowa.pdf');
  });
});
