'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import prettyBytes from 'pretty-bytes';
import {
  FolderIcon,
  DocumentTextIcon,
  UserIcon,
  UsersIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  EllipsisHorizontalIcon,
  TrashIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import { statusToast } from '@/app/lib/utils/toast';
import { getFolders, deleteFolder } from '@/app/actions/folders';
import { EditFolderDialog } from './EditFolderDialog';
import { PiiPolicyBadge } from '../PiiPolicyBadge';
import { cn } from '@/lib/utils';
import type { PiiPolicy } from '@/generated/prisma/browser';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DocumentFolderItem } from '@/features/documents/contracts/document.types';
import { buildFolderTree } from '@/features/documents/utils/folder-tree';
import {
  isFileDrag,
  readDraggedFileIds,
} from '@/features/documents/constants/file-drag';

export type ViewMode = 'all' | 'my-files' | 'shared-with-me';

type UsageData = {
  /** Every file the organization holds, and the allowance it is measured
   * against — see `getKnowledgeBaseUsage`, which explains why the bar is not
   * drawn from knowledge base bytes. */
  totalBytes: number;
  limitBytes: number;
  pageCount: number;
};

/**
 * What each scope holds, access-scoped. `null` while they load.
 *
 * The rail renders `files`; `pages` travels with it because the same query
 * answers both and the page title beside this rail needs the second number.
 * See `getFileScopeCountsQuery`.
 */
export type ScopeTotals = { files: number; pages: number };
export type ScopeCounts = Record<ViewMode, ScopeTotals> | null;

type Props = {
  initialFolders: DocumentFolderItem[];
  onSelectFolder?: (folderId: string | null, viewMode?: ViewMode) => void;
  selectedFolderId?: string | null;
  selectedViewMode?: ViewMode;
  usage?: UsageData | null;
  scopeCounts?: ScopeCounts;
  onFolderMutated?: () => void;
  /**
   * Files dropped onto a folder row, by their ids. `null` is the root — the
   * way to take a document *out* of a folder without opening a dialog.
   *
   * The rail is where a move lands because it is the only place on the page
   * that shows every folder at once, including ones you are not standing in.
   */
  onDropFiles?: (folderId: string | null, fileIds: string[]) => void;
};

/**
 * 30px rows, and the active one carries the marker pattern from phase 3:
 * an accent fill plus a crimson inset hairline. It was `bg-brand-50
 * text-brand-700` — navy — which is the colour every other accent in the panel
 * already uses, so the one signal crimson owns was spent nowhere.
 */
/*
  `text-left` is load-bearing. These are `<button>` elements, and the UA
  stylesheet centres a button's text — invisible while the name span sat beside
  a policy tag that took most of the row, and obvious the moment folders
  without an override stopped carrying one: "Contracts" drifted into the middle
  of the rail while a tagged folder beside it stayed against its icon.
*/
const navItemBase =
  'group/nav relative w-full h-[30px] flex items-center gap-2.5 px-3 rounded-md text-left text-sm cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const navItemActive =
  'bg-accent text-accent-foreground font-medium shadow-[inset_2px_0_0_var(--marker)]';
const navItemInactive = 'text-foreground hover:bg-muted';
/*
  The row a move would land on. Tinted rather than outlined: an outline on a
  30px row inside a 216px rail reads as a focus ring, and this is a hover
  state, not a focus one.
*/
const navItemDropTarget = 'bg-brand-50 dark:bg-brand-900/30';

/** ALL CAPS is allowed here and nowhere else — panel rule 18. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Right-aligned tabular figures, so the column of counts lines up down the
 * rail instead of drifting with each digit.
 */
function NavCount({ value }: { value: number | undefined }) {
  // The app's locale, not the runtime's: `toLocaleString()` groups digits by
  // whatever the browser is set to, which is not what the rest of the page is
  // rendered in.
  const format = useFormatter();

  if (value === undefined) {
    return null;
  }

  return (
    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
      {format.number(value)}
    </span>
  );
}

function countTotalFiles(folder: DocumentFolderItem): number {
  let total = folder.fileCount;
  if (folder.children) {
    for (const child of folder.children) {
      total += countTotalFiles(child);
    }
  }
  return total;
}

/**
 * Pinned to the bottom of the rail: how much of the allowance is gone, and how
 * many pages have been indexed.
 *
 * The bar is determinate and carries the two figures beside it, because a bar
 * alone is a visual-only encoding — the same rule that keeps a percentage
 * beside the relevance bar in the sources rail, and the reason the status
 * badge never rests on colour.
 */
function UsageBlock({ usage }: { usage: UsageData }) {
  const t = useTranslations('folders');
  const format = useFormatter();
  const ratio =
    usage.limitBytes > 0
      ? Math.min(1, Math.max(0, usage.totalBytes / usage.limitBytes))
      : 0;
  const percent = Math.round(ratio * 100);

  return (
    <div className="mt-3 shrink-0 border-t border-border pt-3">
      <Eyebrow>{t('usage')}</Eyebrow>
      <div className="space-y-2 px-3">
        <div>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{t('storage')}</span>
            <span className="tabular-nums font-medium text-foreground">
              {t('storage-of', {
                used: prettyBytes(usage.totalBytes),
                limit: prettyBytes(usage.limitBytes),
              })}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t('storage')}
            className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t('pages')}</span>
          {/*
            The tilde is not decoration. A total sums files whose page counts
            come from two places: Docling reports a real page count for the
            formats that have pages, and everything else — markdown, plain
            text, CSV — is still `ceil(chars / 3000)`. One estimated file makes
            the whole sum an estimate, and nothing records per file which kind
            it was, so the total is marked approximate rather than claiming a
            precision it may not have.

            Drop the tilde when a total is known to be entirely exact, once
            exactness is stored per file.
          */}
          <span className="tabular-nums font-medium text-foreground">
            ~{format.number(usage.pageCount)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function FoldersList({
  initialFolders,
  onSelectFolder,
  selectedFolderId,
  selectedViewMode = 'all',
  usage,
  scopeCounts,
  onFolderMutated,
  onDropFiles,
}: Props) {
  const t = useTranslations('folders');
  const { successToast, errorToast } = statusToast();
  const [folders, setFolders] = useState(initialFolders);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [deletingFolder, setDeletingFolder] = useState<{
    id: string;
    name: string;
    totalFiles: number;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingFolder, setEditingFolder] = useState<{
    id: string;
    name: string;
    piiPolicy?: PiiPolicy | null;
    hasSubfolders: boolean;
  } | null>(null);

  useEffect(() => {
    setFolders(initialFolders);
  }, [initialFolders]);

  const refreshFolders = useCallback(async () => {
    const updated = await getFolders();
    setFolders(updated);
  }, []);

  const handleDeleteFolder = useCallback(async () => {
    if (!deletingFolder) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deleteFolder(deletingFolder.id);

      if (result.success) {
        successToast({ message: t('folder-deleted') });
        refreshFolders();
        onFolderMutated?.();
        if (selectedFolderId === deletingFolder.id) {
          onSelectFolder?.(null, 'all');
        }
      } else {
        errorToast({ message: result.error || t('failed-to-delete') });
      }
    } catch {
      errorToast({ message: t('failed-to-delete') });
    } finally {
      setIsDeleting(false);
      setDeletingFolder(null);
    }
  }, [
    deletingFolder,
    t,
    successToast,
    errorToast,
    refreshFolders,
    selectedFolderId,
    onSelectFolder,
  ]);

  const toggleExpand = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const findFolderInTree = useCallback(
    (id: string, tree: DocumentFolderItem[]): DocumentFolderItem | null => {
      for (const folder of tree) {
        if (folder.id === id) {
          return folder;
        }
        if (folder.children) {
          const found = findFolderInTree(id, folder.children);
          if (found) {
            return found;
          }
        }
      }
      return null;
    },
    [],
  );

  const findAncestorIds = useCallback(
    (
      targetId: string,
      tree: DocumentFolderItem[],
      ancestors: string[] = [],
    ): string[] | null => {
      for (const folder of tree) {
        if (folder.id === targetId) {
          return ancestors;
        }
        if (folder.children) {
          const result = findAncestorIds(targetId, folder.children, [
            ...ancestors,
            folder.id,
          ]);
          if (result !== null) {
            return result;
          }
        }
      }
      return null;
    },
    [],
  );

  useEffect(() => {
    if (!selectedFolderId) {
      return;
    }
    const ancestorIds = findAncestorIds(selectedFolderId, folderTree);
    if (ancestorIds && ancestorIds.length > 0) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        ancestorIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [selectedFolderId, folderTree, findAncestorIds]);

  const openDeleteDialog = useCallback(
    (folderId: string, folderName: string) => {
      const folder = findFolderInTree(folderId, folderTree);
      const totalFiles = folder ? countTotalFiles(folder) : 0;
      setDeletingFolder({ id: folderId, name: folderName, totalFiles });
    },
    [findFolderInTree, folderTree],
  );

  /*
    Which row a move would land on, `null` meaning the root scope row.
    `undefined` is "no drag over the rail at all" — the root has to be a
    droppable value of its own, so it cannot double as "nothing".

    `dragEnter`/`dragLeave` on a row that contains an icon and two spans fires
    once per descendant, so the state is set from `dragOver` (which repeats
    while the pointer is inside) and cleared when the drag leaves the rail as
    a whole.
  */
  const [dropTargetId, setDropTargetId] = useState<string | null | undefined>(
    undefined,
  );

  const dropHandlers = (folderId: string | null) =>
    onDropFiles
      ? {
          onDragOver: (event: React.DragEvent) => {
            if (!isFileDrag(event.dataTransfer)) {
              return;
            }
            // Without `preventDefault` the browser refuses the drop entirely.
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropTargetId(folderId);
          },
          onDrop: (event: React.DragEvent) => {
            if (!isFileDrag(event.dataTransfer)) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            setDropTargetId(undefined);
            const fileIds = readDraggedFileIds(event.dataTransfer);
            if (fileIds.length > 0) {
              onDropFiles(folderId, fileIds);
            }
          },
        }
      : {};

  const renderFolder = (folder: DocumentFolderItem, depth: number = 0) => {
    const hasChildren = folder.children && folder.children.length > 0;
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected =
      selectedFolderId === folder.id && selectedViewMode === 'all';

    return (
      <div key={folder.id}>
        <div className="group relative">
          <button
            type="button"
            className={`${navItemBase} ${isSelected ? navItemActive : navItemInactive} ${dropTargetId === folder.id ? navItemDropTarget : ''}`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => onSelectFolder?.(folder.id, 'all')}
            {...dropHandlers(folder.id)}
          >
            {hasChildren ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(folder.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleExpand(folder.id);
                  }
                }}
                className="shrink-0"
              >
                {isExpanded ? (
                  <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                )}
              </span>
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            {/*
              The name takes the space and the tag gives it up. A 216px rail
              cannot hold both in full, and the name is what you are aiming
              at — a row reading "HR ..." beside a legible policy is the wrong
              half to keep. The tag truncates with its full text in `title`.

              The per-folder file count that used to sit here is gone with it.
              It was the third thing competing for the same 160px, it is not in
              the phase 7 rail, and unlike the scope counts above it answers
              nothing you would act on: opening the folder shows you.
            */}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            {/*
              A folder carries a policy only when it overrides the default, so
              the tag's presence *is* the override — which is why it renders on
              `piiPolicy` being set rather than on it differing from something.
              `mr-5` keeps it clear of the row menu, which appears over the
              right edge on hover.
            */}
            {folder.piiPolicy && (
              <span className="mr-5 min-w-0 max-w-[88px] shrink">
                <PiiPolicyBadge piiPolicy={folder.piiPolicy} compact />
              </span>
            )}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-paper-200 dark:hover:bg-paper-700 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <EllipsisHorizontalIcon className="size-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-40">
              <DropdownMenuItem
                onClick={() =>
                  setEditingFolder({
                    id: folder.id,
                    name: folder.name,
                    piiPolicy: folder.piiPolicy,
                    hasSubfolders: (folder.children?.length ?? 0) > 0,
                  })
                }
              >
                <PencilIcon className="size-4" />
                {t('edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => openDeleteDialog(folder.id, folder.name)}
              >
                <TrashIcon className="size-4" />
                {t('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {folder.children!.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/*
        The highlight is cleared here rather than per row: `dragleave` fires
        when the pointer crosses into a *child* element too, so a per-row
        handler flickers the tint off every time the pointer passes over the
        folder icon inside the row it is standing on. At the rail's edge the
        event means what it says.
      */}
      <div
        className="flex h-full flex-col"
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDropTargetId(undefined);
          }
        }}
        onDragEnd={() => setDropTargetId(undefined)}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {/*
            Scope and folders are two groups under their own eyebrows, not one
            flat list with a rule through it. The folder tree used to sit
            indented under "All files", which made the folders read as a
            property of that one scope rather than as the second way of
            narrowing the same set.
          */}
          <div>
            <Eyebrow>{t('scope')}</Eyebrow>
            <div className="space-y-0.5">
              {/*
                Also the way to take a document *out* of a folder: dropping it
                on "All files" clears its folder. There is no other one-gesture
                route back to unfiled — the row menu's Move opens a dialog.
              */}
              <button
                onClick={() => onSelectFolder?.(null, 'all')}
                aria-current={
                  selectedFolderId === null && selectedViewMode === 'all'
                    ? 'page'
                    : undefined
                }
                className={cn(
                  navItemBase,
                  selectedFolderId === null && selectedViewMode === 'all'
                    ? navItemActive
                    : navItemInactive,
                  dropTargetId === null && navItemDropTarget,
                )}
                {...dropHandlers(null)}
              >
                <DocumentTextIcon className="size-4 shrink-0" />
                <span className="truncate">{t('all-files')}</span>
                <NavCount value={scopeCounts?.all?.files} />
              </button>

              <button
                onClick={() => onSelectFolder?.(null, 'my-files')}
                aria-current={
                  selectedViewMode === 'my-files' ? 'page' : undefined
                }
                className={cn(
                  navItemBase,
                  selectedViewMode === 'my-files'
                    ? navItemActive
                    : navItemInactive,
                )}
              >
                <UserIcon className="size-4 shrink-0" />
                <span className="truncate">{t('my-files')}</span>
                <NavCount value={scopeCounts?.['my-files']?.files} />
              </button>

              <button
                onClick={() => onSelectFolder?.(null, 'shared-with-me')}
                aria-current={
                  selectedViewMode === 'shared-with-me' ? 'page' : undefined
                }
                className={cn(
                  navItemBase,
                  selectedViewMode === 'shared-with-me'
                    ? navItemActive
                    : navItemInactive,
                )}
              >
                <UsersIcon className="size-4 shrink-0" />
                <span className="truncate">{t('shared-with-me')}</span>
                <NavCount value={scopeCounts?.['shared-with-me']?.files} />
              </button>
            </div>
          </div>

          {folderTree.length > 0 && (
            <div>
              <Eyebrow>{t('title')}</Eyebrow>
              <div className="space-y-0.5">
                {folderTree.map((folder) => renderFolder(folder))}
              </div>
            </div>
          )}
        </div>

        {usage && <UsageBlock usage={usage} />}
      </div>

      {editingFolder && (
        <EditFolderDialog
          isOpen={!!editingFolder}
          onClose={() => setEditingFolder(null)}
          folderId={editingFolder.id}
          initialName={editingFolder.name}
          initialPiiPolicy={editingFolder.piiPolicy}
          hasSubfolders={editingFolder.hasSubfolders}
          onUpdated={() => {
            refreshFolders();
            onFolderMutated?.();
            setEditingFolder(null);
          }}
        />
      )}

      <AlertDialog
        open={!!deletingFolder}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeletingFolder(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('delete-title', { folderName: deletingFolder?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletingFolder && deletingFolder.totalFiles > 0
                ? t('delete-confirm-with-files', {
                    count: deletingFolder.totalFiles,
                  })
                : t('delete-confirm-empty')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFolder}
              disabled={isDeleting}
              className="border-destructive/40 bg-transparent text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              {isDeleting ? t('deleting') : t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
