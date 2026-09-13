'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/20/solid';

import { cn } from '@/lib/utils';
import type {
  UserFilesSort,
  UserFilesSortDir,
} from '@/features/documents/contracts/document.types';

/**
 * The sort control, wearing the same face as the filter chips beside it.
 *
 * It used to render only in the grid — the table has sortable column headers,
 * so a second control there looked redundant — and the result was a toolbar
 * that gained and lost a control as you toggled the view, with every chip to
 * its right jumping sideways. A toolbar whose shape depends on which drawing
 * of the same data you picked is a toolbar you have to re-read each time.
 * It renders in both views now; in the table it is a second route to the same
 * sort the headers already offer, which costs one chip and buys a bar that
 * stays put.
 *
 * Not a `FilterChip` with different options. That component is a multi-select
 * list of checkboxes with an `×` to unset it; sort is single-select, carries a
 * direction, and is never unset. Folding the two together would mean a prop
 * for each of those differences and a component that reads as neither.
 *
 * Styled neutral, never `data-active`: sort always has a value, so an accented
 * chip on every page load would read as an active filter and send people
 * looking for the `×` that clears it.
 */

const SORT_COLUMNS: { value: UserFilesSort; labelKey: string }[] = [
  { value: 'fileName', labelKey: 'sort-file-name' },
  { value: 'createdAt', labelKey: 'sort-created' },
  { value: 'fileSize', labelKey: 'sort-file-size' },
  { value: 'fileType', labelKey: 'sort-file-type' },
];

type Props = {
  sort: UserFilesSort;
  dir: UserFilesSortDir;
  onSort: (col: UserFilesSort, newDir: UserFilesSortDir) => void;
};

export function SortChip({ sort, dir, onSort }: Props) {
  const t = useTranslations('files-table');
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const triggerButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    // Escape closes and hands focus back to the trigger — the same pair
    // `FilterChip` makes, and for the same reason: closing unmounts the
    // option the reader was standing on, which would otherwise drop focus to
    // `<body>` and restart the next Tab from the top of the document.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerButton.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const activeLabelKey =
    SORT_COLUMNS.find((column) => column.value === sort)?.labelKey ??
    'sort-file-name';

  const label = t('sort-label');
  const value = t(activeLabelKey as Parameters<typeof t>[0]);
  const direction = t(dir === 'asc' ? 'sort-dir-asc' : 'sort-dir-desc');

  const DirectionIcon = dir === 'asc' ? ChevronUpIcon : ChevronDownIcon;

  return (
    <div ref={container} className="relative">
      <div
        data-testid="sort-chip"
        className="flex items-center rounded-md border border-border bg-card text-sm text-foreground dark:bg-muted"
      >
        <button
          ref={triggerButton}
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          // A disclosure, not a menu — same reasoning as `FilterChip`.
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          // The face shows the column and an arrow; the accessible name spells
          // the direction out, because an arrow glyph is not a word.
          aria-label={`${label}: ${value} — ${direction}`}
          title={`${label}: ${value} — ${direction}`}
          className="flex items-center gap-1 rounded-md px-3 py-1.5"
        >
          <span>
            {label}: {value}
          </span>
          <DirectionIcon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </div>
      {open ? (
        <div
          id={menuId}
          className="absolute left-0 z-20 mt-1 w-56 rounded-md border border-border bg-card shadow-lg dark:bg-muted"
        >
          {SORT_COLUMNS.map((column) => {
            const columnLabel = t(column.labelKey as Parameters<typeof t>[0]);
            return (
              <div key={column.value}>
                {(['asc', 'desc'] as const).map((optionDir) => {
                  const isCurrent = sort === column.value && dir === optionDir;
                  const OptionIcon =
                    optionDir === 'asc' ? ChevronUpIcon : ChevronDownIcon;
                  return (
                    <button
                      key={optionDir}
                      type="button"
                      onClick={() => {
                        onSort(column.value, optionDir);
                        setOpen(false);
                      }}
                      aria-current={isCurrent ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted dark:hover:bg-paper-700',
                        isCurrent
                          ? 'font-semibold text-primary'
                          : 'text-foreground',
                      )}
                    >
                      <OptionIcon
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      {columnLabel} —{' '}
                      {t(
                        optionDir === 'asc' ? 'sort-dir-asc' : 'sort-dir-desc',
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Exported for tests that need to know which columns the menu offers. */
export { SORT_COLUMNS };
