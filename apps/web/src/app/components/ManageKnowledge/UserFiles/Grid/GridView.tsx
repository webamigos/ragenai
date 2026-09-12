import { useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';

import { SpinnerSVG } from '@ragenai/common-ui/icons';
import { statusToast } from '@/app/lib/utils/toast';
import { type UserFile } from '@/generated/prisma/browser';

import {
  ArrowUpTrayIcon,
  FolderIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { EmptyState } from '@ragenai/common-ui/EmptyState';

import { FileCard } from './FileCard';
import { DeleteFileModal } from '../DeleteFileModal';

import {
  type ModalStateProps,
  type UserFileTypeSafe,
} from '../FileList/UserFilesTable';
import {
  type UserFileType,
  type DocumentFolderItem,
} from '@/features/documents/contracts/document.types';

type GridViewProps = {
  files: UserFileType[];
  subfolders?: DocumentFolderItem[];
  onNavigateFolder?: (folderId: string) => void;
  /** See `FileRowProps.onDragFiles` in `UserFilesTable`. */
  onDragFiles?: (fileId: string) => string[];
  isLoading: boolean;
  isError: boolean;
  showModal: ModalStateProps;
  deleteLoading: boolean;
  toggleModal: (publicFileId: UserFile['id'] | null) => void;
  addFile: (newFile: UserFileType) => void;
  removeFile: (publicFileId: UserFile['id']) => void;
  handleDelete: (
    fileId: UserFile['id'],
    fileName: UserFile['fileName'],
  ) => void;
  isSelected?: (id: string) => boolean;
  isAllSelected?: (ids: string[]) => boolean;
  isIndeterminate?: (ids: string[]) => boolean;
  onToggleFile?: (id: string) => void;
  onToggleAll?: (ids: string[]) => void;
  onUpload?: () => void;
  onCreateDocument?: () => void;
  onAddFromUrl?: () => void;
  onPreviewFile?: (file: UserFileTypeSafe) => void;
  onMove?: (fileId: string) => void;
  onShare?: (fileId: string) => void;
  onScore?: (fileId: string) => void;
  isFilteredEmpty?: boolean;
  onResetFilters?: () => void;
  canManageOrg?: boolean;
};

export const GridView = ({
  files,
  subfolders = [],
  onNavigateFolder,
  onDragFiles,
  isLoading,
  deleteLoading,
  isError,
  showModal,
  handleDelete,
  toggleModal,
  isSelected,
  isAllSelected,
  isIndeterminate,
  onToggleFile,
  onToggleAll,
  onUpload,
  onCreateDocument,
  onAddFromUrl,
  onPreviewFile,
  onMove,
  onShare,
  onScore,
  isFilteredEmpty = false,
  onResetFilters,
  canManageOrg,
}: GridViewProps) => {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const fileIds = files.map((f) => f.id);
  const t = useTranslations('error-toast');
  const tFolders = useTranslations('folders');
  const tFilesTable = useTranslations('files-table');
  const tBulkBar = useTranslations('bulk-action-bar');
  const { errorToast } = statusToast();

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isIndeterminate
        ? isIndeterminate(fileIds)
        : false;
    }
  }, [isIndeterminate, fileIds]);

  if (isLoading) {
    return <SpinnerSVG size="sm" />;
  }

  if (isError) {
    errorToast({ message: t('fetching-error') });
    return null;
  }

  if (files.length === 0 && subfolders.length === 0) {
    if (isFilteredEmpty) {
      return (
        <EmptyState
          icon={<FunnelIcon className="size-10 text-muted-foreground" />}
          title={tFilesTable('no-results-for-filters')}
          actions={
            onResetFilters
              ? [
                  {
                    label: tFilesTable('reset-filters'),
                    onClick: onResetFilters,
                  },
                ]
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

  return (
    <>
      {onToggleAll && (
        <div className="flex shrink-0 items-center gap-2 mb-2 px-1">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={isAllSelected ? isAllSelected(fileIds) : false}
            onChange={() => onToggleAll(fileIds)}
            aria-label={tBulkBar('select-all')}
            data-testid="grid-select-all-checkbox"
            className="size-4 cursor-pointer rounded border-border accent-primary"
          />
          <span className="text-sm text-muted-foreground">
            {tBulkBar('select-all')}
          </span>
        </div>
      )}
      {/*
        The grid is the scroller in this view, the way the table's wrapper is
        in the other: the toolbar above and the pagination strip below are
        static, and only the cards move.

        `auto-rows-min content-start` keeps the cards at the top of a tall
        pane. Without them a short grid stretches its rows to fill the height
        it has just been given, and two files become two very tall cards —
        rule 5, nothing centres or spreads vertically in a full-height pane.

        No `overscroll-contain` here either — see the note on the table's
        wrapper for why it is a risk below `lg` and a no-op above it.
      */}
      <div className="grid min-h-0 flex-1 auto-rows-min content-start overflow-y-auto grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 px-0.5 pt-1">
        {subfolders.map((folder) => (
          <button
            key={`folder-${folder.id}`}
            type="button"
            onClick={() => onNavigateFolder?.(folder.id)}
            className="flex items-center gap-3 rounded-lg border border-border bg-card dark:bg-muted p-4 text-left hover:bg-muted dark:hover:bg-paper-700/50 transition-colors"
          >
            <FolderIcon className="size-8 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-sm text-foreground truncate">
                {folder.name}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tFolders('file-count', { count: folder.fileCount })}
              </p>
            </div>
          </button>
        ))}
        {files.map((file) => (
          <FileCard
            key={file.id}
            file={file as UserFileTypeSafe}
            isLoading={isLoading}
            deleteLoading={deleteLoading}
            toggleModal={toggleModal}
            isSelected={isSelected ? isSelected(file.id) : undefined}
            onToggleFile={onToggleFile}
            onPreviewFile={onPreviewFile}
            onMove={onMove}
            onShare={onShare}
            onScore={onScore}
            canManageOrg={canManageOrg}
            onDragFiles={onDragFiles}
          />
        ))}
        {showModal.fileId && (
          <DeleteFileModal
            isOpen={showModal.isOpen}
            onClose={() => toggleModal(null)}
            onConfirm={handleDelete}
            fileName={
              files.find((f) => f.id === showModal.fileId)?.fileName ?? ''
            }
            fileId={showModal.fileId}
            isLoading={deleteLoading}
          />
        )}
      </div>
    </>
  );
};
