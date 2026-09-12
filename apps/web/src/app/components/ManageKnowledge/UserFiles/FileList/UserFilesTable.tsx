import React, { useState, useRef, useMemo, type ComponentProps } from 'react';
import prettyBytes from 'pretty-bytes';
import { useFormatter, useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/ui/status-badge';
import { DEFAULT_PROJECT_TITLE } from '@/features/organizations/constants/settings';

import {
  EmbeddingStatus,
  ParsingStatus,
  type FileType,
  type PiiPolicy,
  type UserFile,
} from '@/generated/prisma/browser';
import { cn } from '@/lib/utils';
import { DeleteFileModal } from '../DeleteFileModal';
import { getFileLabel } from '@ragenai/common-ui/utils/file-helpers';

import {
  type UserFileType,
  type DocumentFolderItem,
  type UserFilesSort,
  type UserFilesSortDir,
} from '@/features/documents/contracts/document.types';
import { ToolbarActions } from './ToolbarActions';
import {
  FolderIcon,
  ArrowUpTrayIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { SuspiciousContentBadge } from './SuspiciousContentBadge';
import { RagScoreBadge } from './RagScoreBadge';
import { PiiPolicyBadge } from '../../PiiPolicyBadge';
import { Tooltip } from '@ragenai/common-ui/Tooltip';
import { EmptyState } from '@ragenai/common-ui/EmptyState';
import { setDraggedFileIds } from '@/features/documents/constants/file-drag';
import { scoreDocumentAction } from '@/app/[locale]/(panel)/knowledge/optimize-document/actions';

import { statusToast } from '@/app/lib/utils/toast';
import { useRouter } from '@/i18n/routing';

/**
 * The knowledge base table is a fixed grid, not the shared `<Table>`.
 *
 * Design system v2 phase 7 gives every column an exact width and the row an
 * exact height, and puts a `min-width` on the grid so the name column never
 * collapses — the table scrolls instead of squeezing. The shared primitive
 * bakes in its own padding, a `text-sm/6` line box and an auto layout, so
 * meeting the spec through it would mean overriding most of what it does.
 *
 * It keeps real table semantics: this is tabular data with a sortable header,
 * and `aria-sort` on a `<th>` is understood in a way a grid of divs is not.
 * Members and audit stay on the shared primitive until their own phase.
 */
const COLUMN = {
  select: 'w-7',
  name: 'w-auto',
  /*
    88px, not the 76 phase 7 specified. `prettyBytes` renders "2.41 MB" —
    seven characters plus the cell's 24px of padding — and 76px left it one or
    two pixels short, so every file over a megabyte wrapped its unit onto a
    second line and took its row to two. A table whose rows are 34px except
    when they are 48px is not a table you can scan down.
  */
  size: 'w-[88px]',
  added: 'w-[128px]',
  status: 'w-[108px]',
  policy: 'w-[168px]',
  actions: 'w-8',
} as const;

/**
 * 30px, 11px uppercase display, per the phase 7 header rule.
 *
 * The labels are `column-*`, not the `sort-*` strings the sort chip uses. The
 * two read in different frames: the chip says "Sort: Date Added", the column
 * says ADDED, and phase 7 names the columns FILE NAME · SIZE · ADDED · STATUS
 * · PII POLICY. One set of words could not be both without one of them
 * reading like a sentence fragment.
 *
 * Sticky, so the column names stay put while the rows move under them. Three
 * details make that work and are easy to undo by accident:
 *
 * - `bg-card`, because a transparent sticky header lets the rows show through
 *   it as they pass.
 * - `sticky` on each `<th>` rather than on `<thead>` or its `<tr>` — the row
 *   and section variants are not honoured consistently across engines.
 * - the table is `border-separate border-spacing-0`, not `border-collapse`.
 *   Under collapse the resolved border belongs to the *table* and is painted
 *   in the table's layer, so it does not travel with the sticky cell and the
 *   header's hairline disappears the moment you scroll. Geometry is
 *   unchanged because every rule in this table is a single `border-b`, so
 *   nothing doubles up.
 *
 * `z-10` sits below Radix's portalled row menus, which render at body level.
 */
function Th({ className, ...props }: React.ComponentPropsWithoutRef<'th'>) {
  return (
    <th
      {...props}
      className={cn(
        'sticky top-0 z-10 h-[30px] border-b border-paper-200 bg-card px-3 text-left align-middle font-display text-[11px] font-medium uppercase tracking-wide text-muted-foreground dark:border-paper-800',
        className,
      )}
    />
  );
}

/**
 * 34px, and ruled in `paper-100` rather than `--border`. The grid reads
 * without ruling every cell, so the rule is quieter than a border token.
 */
function Td({ className, ...props }: React.ComponentPropsWithoutRef<'td'>) {
  return (
    <td
      {...props}
      className={cn(
        'h-[34px] border-b border-paper-100 px-3 align-middle dark:border-paper-800/60',
        className,
      )}
    />
  );
}

type SelectionProps = {
  isSelected?: (id: string) => boolean;
  isAllSelected?: (ids: string[]) => boolean;
  isIndeterminate?: (ids: string[]) => boolean;
  onToggleFile?: (id: string) => void;
  onToggleAll?: (ids: string[]) => void;
};

type Props = {
  files: UserFileType[];
  subfolders?: DocumentFolderItem[];
  onNavigateFolder?: (folderId: string) => void;
  showModal: ModalStateProps;
  deleteLoading: boolean;
  toggleModal: (fileId: UserFile['id'] | null) => void;
  onAddFile: (newFile: UserFileType) => void;
  onRemoveFile: (fileId: UserFile['id']) => void;
  handleDelete: (
    fileId: UserFile['id'],
    fileName: UserFile['fileName'],
  ) => void;
  onUpload?: () => void;
  onCreateDocument?: () => void;
  onAddFromUrl?: () => void;
  onPreviewFile?: (file: UserFileTypeSafe) => void;
  sort?: UserFilesSort;
  dir?: UserFilesSortDir;
  onSort?: (column: UserFilesSort) => void;
  SortIcon?: React.ComponentType<{ column: UserFilesSort }>;
  isFilteredEmpty?: boolean;
  onResetFilters?: () => void;
  canManageOrg?: boolean;
  /** See `FileRowProps.onDragFiles`. */
  onDragFiles?: (fileId: string) => string[];
  /** See `FileRowProps.onChangeRowPolicy`. */
  onChangeRowPolicy?: (fileId: string) => void;
} & SelectionProps;

export type UserFileTypeSafe = UserFileType & {
  fileType: FileType;
  embeddingStatus: EmbeddingStatus;
  embeddingStartedAt: UserFile['embeddingStartedAt'];
  embeddingCompletedAt: UserFile['embeddingCompletedAt'];
  embeddingFailedAt: UserFile['embeddingFailedAt'];
};

type FileRowProps = {
  file: UserFileTypeSafe;
  showModal: ModalStateProps;
  deleteLoading: boolean;
  handleDelete: (fileId: UserFile['id'], fileName: string) => void;
  toggleModal: (fileId: UserFile['id'] | null) => void;
  onRemoveFile: (fileId: UserFile['id']) => void;
  isSelected?: boolean;
  onToggleFile?: (id: string) => void;
  onPreviewFile?: (file: UserFileTypeSafe) => void;
  canManageOrg?: boolean;
  /**
   * Starts a move: hands back the ids this drag should carry. The row does
   * not decide that on its own — dragging a row that is part of a selection
   * moves the whole selection, and only the component holding the selection
   * knows what that is.
   */
  onDragFiles?: (fileId: string) => string[];
  /**
   * Opens the confirmation dialog for this file's PII policy. Absent for
   * anyone who may not change it, so the menu item is missing rather than
   * present and disabled.
   */
  onChangeRowPolicy?: (fileId: string) => void;
};

export type ModalStateProps = {
  isOpen: boolean;
  fileId: UserFile['id'] | null;
};

function FileStatusBadge({
  embeddingStatus,
  parsingStatus,
}: {
  embeddingStatus?: EmbeddingStatus;
  parsingStatus?: ParsingStatus;
}) {
  const t = useTranslations('files-table');

  if (embeddingStatus === EmbeddingStatus.COMPLETED) {
    return <StatusBadge state="ready" label={t('status-ready')} />;
  }

  if (
    embeddingStatus === EmbeddingStatus.FAILED ||
    parsingStatus === ParsingStatus.FAILED
  ) {
    return <StatusBadge state="failed" label={t('status-failed')} />;
  }

  if (
    embeddingStatus === EmbeddingStatus.STARTED ||
    parsingStatus === ParsingStatus.STARTED
  ) {
    return <StatusBadge state="processing" label={t('status-processing')} />;
  }

  // NOT_STARTED — uploaded, waiting for a worker to pick it up. This used to
  // render as `processing` with a pulsing dot, which said work was underway
  // when none had started; `queued` is the state the design has for it.
  return <StatusBadge state="queued" label={t('status-queued')} />;
}

const FileRow = ({
  file,
  showModal,
  deleteLoading,
  toggleModal,
  handleDelete,
  isSelected,
  onToggleFile,
  onPreviewFile,
  canManageOrg,
  onDragFiles,
  onChangeRowPolicy,
}: FileRowProps) => {
  const [isLoading] = useState(false);
  const [isScoringLoading, setIsScoringLoading] = useState(false);
  const tBulkBar = useTranslations('bulk-action-bar');
  const { infoToast, errorToast } = statusToast();
  const router = useRouter();

  const tOptimizer = useTranslations('document-optimizer');
  const format = useFormatter();

  const handleScore = async (fId: string) => {
    setIsScoringLoading(true);
    try {
      await scoreDocumentAction(fId);
      infoToast({ message: tOptimizer('score-started') });
    } catch {
      errorToast({ message: tOptimizer('score-error') });
    } finally {
      setIsScoringLoading(false);
    }
  };

  const {
    createdAt,
    fileName,
    fileSize,
    id: fileIdVal,
    embeddingStatus,
  } = file;

  /*
    "6 Sep, 12:54" — phase 7's format for this column, and 128px of it.

    It was `dd.MM.yyyy HH:mm:ss`, which is 19 characters: it wrapped to two
    lines in every row and spent the second one on seconds nobody reads off a
    file list. `useFormatter` rather than `formatDates` because the month is a
    word now, so it has to be the page's language — and the provider's time
    zone, so the server and the browser agree on which day it is.

    The year is deliberately absent: the column is sorted newest-first and the
    full timestamp is in the preview. A file old enough for the year to matter
    is one you reached by sorting, not by scanning.
  */
  const formattedCreatedAt = useMemo(
    () =>
      createdAt
        ? format.dateTime(new Date(createdAt), {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            // 24-hour in every locale, as the rest of the panel already is —
            // `en` would otherwise render "Sep 6, 12:54 PM", three characters
            // wider than the column and the only place in the app that asks
            // the reader to think about AM. The *order* stays the locale's:
            // "Sep 6" in English, "6 wrz" in Polish.
            hour12: false,
          })
        : '-',
    [createdAt, format],
  );

  return (
    <>
      <DeleteFileModal
        isOpen={showModal.isOpen && showModal.fileId === file.id}
        onClose={() => toggleModal(null)}
        onConfirm={handleDelete}
        fileId={file.id}
        fileName={file.fileName}
        isLoading={deleteLoading}
      />
      {/*
        Draggable onto a folder in the rail, which files it there.

        A shortcut, never the only route: "Move" stays in the row's menu and
        on the selection bar, because a drag is unavailable to a keyboard and
        awkward on a touch screen.
      */}
      <tr
        className={`group text-sm cursor-pointer hover:bg-muted dark:hover:bg-muted${isSelected ? ' bg-accent/20' : ''}`}
        data-testid={`file-row-${file.id}`}
        onClick={() => onPreviewFile?.(file)}
        draggable={onDragFiles !== undefined}
        onDragStart={(event) => {
          if (!onDragFiles) {
            return;
          }
          setDraggedFileIds(event.dataTransfer, onDragFiles(file.id));
        }}
      >
        {onToggleFile && (
          <Td className="pr-0">
            <span className="flex h-full items-center">
              <input
                type="checkbox"
                checked={!!isSelected}
                onChange={() => onToggleFile(file.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={tBulkBar('select-file', {
                  fileName: file.fileName,
                })}
                data-testid={`file-checkbox-${file.id}`}
                className="size-4 cursor-pointer rounded border-border accent-primary"
              />
            </span>
          </Td>
        )}
        {/*
          The name is text, not a link.

          The row already has a click target — it opens the preview drawer —
          and the name used to be a second one going somewhere else entirely,
          the extracted-content page. Two destinations in one row, one of them
          hidden inside the other, and which you got depended on hitting a few
          characters of filename. It also only appeared on files that had
          finished parsing, so the same column was a link or not depending on
          state nobody was reading it for.

          Reaching the extracted content is a deliberate act now: Actions →
          View, in the row's own menu, which already offered exactly that.
        */}
        <Td>
          <span className="flex min-w-0 items-center gap-2">
            {/*
              The extension as a tag, so the type is readable at a glance and
              the name does not have to be squinted at for its last four
              characters. `getFileLabel` reads the extension the file actually
              has rather than the `fileType` enum, which buckets several
              extensions into one value.

              It is the only type marker. A coloured icon used to sit beside
              it saying the same thing twice — and saying it wrong, because
              the icon comes from `fileType` and the tag from the extension:
              a `.txt` file bucketed as MARKDOWN showed a markdown icon next
              to a TXT tag. Two marks that disagree are worse than one, and
              phase 7's name column has room for one.
            */}
            <span className="shrink-0 rounded border border-paper-200 px-1 font-mono text-[9px] leading-4 text-muted-foreground dark:border-paper-800">
              {getFileLabel(fileName)}
            </span>
            {/*
              The name is the keyboard's way in.

              The row opens the preview on click, and a `<tr>` cannot take
              focus or answer Enter, so until now the preview was reachable
              by mouse only. Making the row itself focusable is the wrong
              repair: it holds a checkbox, a policy select and a menu, and a
              button wrapped around other controls is a worse thing to land
              on than an unreachable row.

              So the name carries it. One destination, the same one the row
              has — this is not the second target the panel rules forbid,
              which was a *different* destination hidden inside the row.

              Truncated by the column rather than by a character count: a
              hard cut at 40 characters clipped names that fit and kept names
              that did not, and only CSS knows the width.
            */}
            {onPreviewFile ? (
              <button
                type="button"
                onClick={(e) => {
                  // The row handles the click as well; without this the
                  // preview would be asked for twice.
                  e.stopPropagation();
                  onPreviewFile(file);
                }}
                title={fileName}
                className="min-w-0 truncate rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {fileName}
              </button>
            ) : (
              /* Nothing to open, so nothing to focus. A control that does
                 nothing is worse in a tab order than no control. */
              <span className="min-w-0 truncate" title={fileName}>
                {fileName}
              </span>
            )}
            <SuspiciousContentBadge metadata={file.metadata} />
            <RagScoreBadge metadata={file.metadata} />
          </span>
        </Td>
        {/*
          `whitespace-nowrap` on both, as the belt to the column widths'
          braces. A wrapped number is a taller row, and a taller row is a
          broken rhythm — which is the one thing this table is for.
        */}
        <Td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
          {prettyBytes(fileSize)}
        </Td>
        <Td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
          {formattedCreatedAt}
        </Td>
        <Td>
          <FileStatusBadge
            embeddingStatus={file.embeddingStatus}
            parsingStatus={file.parsingStatus}
          />
        </Td>
        {canManageOrg === true && (
          /*
            The policy, not a control for it.

            This cell used to hold a live select, so a file's masking could
            change from a stray click in a menu nobody meant to open — no
            confirmation, and nothing said about the text already indexed
            under the old policy. It reads now, and changing it is an item in
            the row's menu behind a dialog, the same deliberate step Delete
            gets. Panel rule 12 already says every row action belongs in that
            menu; this was the one that had climbed out of it.
          */
          <Td>
            <PiiPolicyBadge piiPolicy={file.piiPolicy as PiiPolicy} compact />
          </Td>
        )}
        <Td className="text-right" onClick={(e) => e.stopPropagation()}>
          <ToolbarActions
            fileId={fileIdVal!}
            documentId={file.document?.id}
            fileName={fileName}
            toggleModal={toggleModal}
            isLoading={isLoading}
            onScore={
              embeddingStatus === EmbeddingStatus.COMPLETED
                ? handleScore
                : undefined
            }
            isScoringLoading={isScoringLoading}
            onChangePolicy={onChangeRowPolicy}
          />
        </Td>
      </tr>
    </>
  );
};

export const UserFilesTable = ({
  files,
  subfolders = [],
  onNavigateFolder,
  showModal,
  deleteLoading,
  toggleModal,
  handleDelete,
  onRemoveFile,
  isSelected,
  isAllSelected,
  isIndeterminate,
  onToggleFile,
  onToggleAll,
  onUpload,
  onCreateDocument,
  onAddFromUrl,
  onPreviewFile,
  sort,
  dir,
  onSort,
  SortIcon,
  isFilteredEmpty = false,
  onResetFilters,
  canManageOrg,
  onDragFiles,
  onChangeRowPolicy,
}: Props & ComponentProps<'table'>) => {
  const t = useTranslations('files-table');
  const tBulkBar = useTranslations('bulk-action-bar');
  const tFolders = useTranslations('folders');
  const [searchValue] = useState('');

  const filteredDocuments = useMemo(() => {
    if (!searchValue) {
      return files as UserFileTypeSafe[];
    }

    return files.filter(
      (file) =>
        file.fileName.toLowerCase().includes(searchValue.toLowerCase()) &&
        (file.project?.title === 'Default' ||
          file.project?.title === DEFAULT_PROJECT_TITLE),
    ) as UserFileTypeSafe[];
  }, [files, searchValue]);

  const hasContent = subfolders.length > 0 || filteredDocuments.length > 0;
  const fileIds = useMemo(
    () => filteredDocuments.map((f) => f.id),
    [filteredDocuments],
  );
  const showCheckboxes = !!onToggleFile;

  if (!hasContent) {
    if (isFilteredEmpty) {
      return (
        <EmptyState
          icon={<FunnelIcon className="size-10 text-muted-foreground" />}
          title={t('no-results-for-filters')}
          actions={
            onResetFilters
              ? [{ label: t('reset-filters'), onClick: onResetFilters }]
              : undefined
          }
          className="py-20"
        />
      );
    }
    const actions = onUpload
      ? [
          { label: tFolders('upload-cta'), onClick: onUpload },
          ...(onCreateDocument
            ? [
                {
                  label: tFolders('create-document'),
                  onClick: onCreateDocument,
                },
              ]
            : []),
          ...(onAddFromUrl
            ? [{ label: tFolders('add-from-url'), onClick: onAddFromUrl }]
            : []),
        ]
      : undefined;
    return (
      <EmptyState
        icon={<ArrowUpTrayIcon className="size-10 text-muted-foreground" />}
        title={tFolders('no-documents')}
        description={tFolders('drag-drop')}
        actions={actions}
        className="py-20"
      />
    );
  }

  const ariaSortFor = (col: string): 'ascending' | 'descending' | 'none' => {
    if (sort !== col) {
      return 'none';
    }
    return dir === 'asc' ? 'ascending' : 'descending';
  };

  return (
    /*
      The grid has a floor and the wrapper scrolls, rather than the columns
      squeezing. Below 840px the name column would otherwise be the one that
      gives, and a file name that has to be guessed at is the one thing this
      table exists to show.

      This wrapper is also the page's *only* vertical scroller. The toolbar
      above it and the pagination strip below it are its siblings and stay
      put; `min-h-0 flex-1` is what makes it take the height that is left
      instead of the height of its rows. `overflow-x-auto overflow-y-auto`
      rather than `overflow-auto`: the two are equivalent to the browser, but
      the explicit pair is what `sticky` on the header resolves against and
      what the grid test asserts.

      `border-separate` is load-bearing for that sticky header — see the
      comment on `Th`.

      Deliberately no `overscroll-contain`. Below `lg` the shell has no fixed
      height, so this box grows to its rows and never scrolls — yet it is
      still a scroll container, and `contain` on one of those can stop a
      wheel from chaining out to the page that *does* scroll. At `lg` the
      page cannot scroll at all, so containment has nothing to prevent. It
      is a risk on one breakpoint and a no-op on the other.
    */
    <div className="relative min-h-0 flex-1 overflow-x-auto overflow-y-auto">
      <table className="w-full min-w-[840px] table-fixed border-separate border-spacing-0 text-sm [&_tbody_tr:last-child_td]:border-b-0">
        <colgroup>
          {showCheckboxes && <col className={COLUMN.select} />}
          <col className={COLUMN.name} />
          <col className={COLUMN.size} />
          <col className={COLUMN.added} />
          <col className={COLUMN.status} />
          {canManageOrg === true && <col className={COLUMN.policy} />}
          <col className={COLUMN.actions} />
        </colgroup>
        <thead>
          <tr>
            {showCheckboxes && (
              <Th className="pr-0">
                <Tooltip
                  content={tBulkBar('select-all')}
                  id="select-all-tooltip"
                  place="right"
                  delayShow={500}
                >
                  <input
                    type="checkbox"
                    checked={isAllSelected ? isAllSelected(fileIds) : false}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = isIndeterminate
                          ? isIndeterminate(fileIds)
                          : false;
                      }
                    }}
                    onChange={() => onToggleAll?.(fileIds)}
                    aria-label={tBulkBar('select-all')}
                    data-testid="select-all-checkbox"
                    className="size-4 cursor-pointer rounded border-border accent-primary"
                  />
                </Tooltip>
              </Th>
            )}
            <Th
              className={cn(
                sort === 'fileName' && 'text-brand-700 dark:text-brand-300',
              )}
              aria-sort={ariaSortFor('fileName')}
              data-testid="sort-header-fileName"
            >
              <button
                type="button"
                /*
                  `uppercase` again on the button: Tailwind's preflight sets
                  `text-transform: none` on `button`, which beats the `<th>`'s
                  own `uppercase` by being the more specific declaration on the
                  element itself. Without it the three sortable columns read
                  "File name · Size · Added" beside "STATUS · PII POLICY", and
                  the header looks half-styled rather than deliberately mixed.
                */
                className={`flex items-center gap-1 uppercase ${onSort ? 'cursor-pointer select-none' : ''}`}
                onClick={() => onSort?.('fileName')}
                disabled={!onSort}
              >
                {t('column-file-name')}
                {SortIcon && (
                  <span data-testid="sort-icon-fileName">
                    <SortIcon column="fileName" />
                  </span>
                )}
              </button>
            </Th>
            <Th
              className={cn(
                'text-right',
                sort === 'fileSize' && 'text-brand-700 dark:text-brand-300',
              )}
              aria-sort={ariaSortFor('fileSize')}
              data-testid="sort-header-fileSize"
            >
              <button
                type="button"
                className={cn(
                  // See the fileName header: `button` resets text-transform.
                  'ml-auto flex items-center gap-1 uppercase',
                  onSort && 'cursor-pointer select-none',
                )}
                onClick={() => onSort?.('fileSize')}
                disabled={!onSort}
              >
                {t('column-size')}
                {SortIcon && (
                  <span data-testid="sort-icon-fileSize">
                    <SortIcon column="fileSize" />
                  </span>
                )}
              </button>
            </Th>
            <Th
              className={cn(
                'text-right',
                sort === 'createdAt' && 'text-brand-700 dark:text-brand-300',
              )}
              aria-sort={ariaSortFor('createdAt')}
              data-testid="sort-header-createdAt"
            >
              <button
                type="button"
                className={cn(
                  // See the fileName header: `button` resets text-transform.
                  'ml-auto flex items-center gap-1 uppercase',
                  onSort && 'cursor-pointer select-none',
                )}
                onClick={() => onSort?.('createdAt')}
                disabled={!onSort}
              >
                {t('column-added')}
                {SortIcon && (
                  <span data-testid="sort-icon-createdAt">
                    <SortIcon column="createdAt" />
                  </span>
                )}
              </button>
            </Th>
            <Th>{t('column-status')}</Th>
            {canManageOrg === true && (
              <Th data-testid="pii-policy-column-header">
                {t('column-pii-policy')}
              </Th>
            )}
            <Th>
              <span className="sr-only">{t('column-actions')}</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {/* Folder rows */}
          {subfolders.map((folder) => (
            <tr
              key={`folder-${folder.id}`}
              className="text-sm cursor-pointer hover:bg-muted"
              onClick={() => onNavigateFolder?.(folder.id)}
            >
              {showCheckboxes && <Td className="pr-0" />}
              <Td>
                <span className="flex items-center gap-2">
                  <FolderIcon className="size-5 text-muted-foreground shrink-0" />
                  <span className="font-medium">{folder.name}</span>
                  {folder.teamName && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-accent text-primary dark:bg-primary/15">
                      {folder.teamName}
                    </span>
                  )}
                </span>
              </Td>
              <Td>
                <span className="text-xs text-muted-foreground">
                  {tFolders('file-count', { count: folder.fileCount })}
                </span>
              </Td>
              <Td />
              <Td />
              {canManageOrg === true && <Td />}
              <Td />
            </tr>
          ))}

          {/* File rows */}
          {filteredDocuments.map((file) => (
            <FileRow
              deleteLoading={deleteLoading}
              key={file.id}
              file={file}
              showModal={showModal}
              toggleModal={toggleModal}
              handleDelete={handleDelete}
              onRemoveFile={onRemoveFile}
              isSelected={isSelected ? isSelected(file.id) : undefined}
              onToggleFile={onToggleFile}
              onPreviewFile={onPreviewFile}
              canManageOrg={canManageOrg}
              onDragFiles={onDragFiles}
              onChangeRowPolicy={onChangeRowPolicy}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};
