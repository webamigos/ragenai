import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { SortChip } from '../SortChip';
import messages from '@/app/messages/en.json';
import type {
  UserFilesSort,
  UserFilesSortDir,
} from '@/features/documents/contracts/document.types';

function show(
  sort: UserFilesSort = 'createdAt',
  dir: UserFilesSortDir = 'desc',
  onSort = vi.fn(),
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SortChip sort={sort} dir={dir} onSort={onSort} />
    </NextIntlClientProvider>,
  );
  return { onSort };
}

const trigger = () => screen.getByRole('button', { name: /^Sort:/ });

describe('SortChip', () => {
  it('says what the list is sorted by, on its face', () => {
    show('createdAt', 'desc');

    // Same contract as the filter chips beside it: the value belongs on the
    // control, not behind it.
    expect(trigger()).toHaveTextContent('Sort: Date Added');
  });

  it('spells the direction out for a reader who cannot see the arrow', () => {
    show('fileName', 'asc');

    // The face carries a chevron, which is not a word.
    expect(trigger()).toHaveAccessibleName('Sort: File Name — Ascending');
  });

  it('names the other direction when the direction flips', () => {
    show('fileName', 'desc');

    expect(trigger()).toHaveAccessibleName('Sort: File Name — Descending');
  });

  it('asks for a column and a direction together', async () => {
    const user = userEvent.setup();
    const { onSort } = show('createdAt', 'desc');

    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: /File Name — Asc/i }));

    // Not a toggle: the chip names the direction it wants, unlike a column
    // header, which only says "the other way round from now".
    expect(onSort).toHaveBeenCalledWith('fileName', 'asc');
  });

  it('closes after a choice', async () => {
    const user = userEvent.setup();
    show();

    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: /Size — Desc/i }));
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('is never drawn as an active filter', () => {
    show('fileSize', 'asc');

    // Sort always has a value. An accented chip on every page load would read
    // as a filter that is doing something, and send people looking for the
    // "×" that clears it.
    expect(screen.getByTestId('sort-chip')).not.toHaveAttribute('data-active');
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
  });

  it('closes on Escape and gives focus back to the trigger', async () => {
    const user = userEvent.setup();
    show();

    await user.click(trigger());
    await user.keyboard('{Escape}');

    // Closing unmounts the option the reader was standing on, which would
    // otherwise drop focus to <body> and restart the next Tab from the top of
    // the document.
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();
  });
});
