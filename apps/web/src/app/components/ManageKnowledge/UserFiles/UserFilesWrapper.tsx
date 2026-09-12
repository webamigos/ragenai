'use client';

import { useTranslations } from 'next-intl';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  FolderPlusIcon,
  ArrowUpTrayIcon,
  ComputerDesktopIcon,
  DocumentPlusIcon,
  GlobeAltIcon,
  SparklesIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

import { useUserFilesContext } from '@/app/hooks/useUserFilesContext';
import { deleteFileAction } from '@/app/actions';
import { uploadFiles as uploadFilesApi } from '@/app/lib/services/api';
import { statusToast } from '@/app/lib/utils/toast';
import { useSettings } from '@/app/hooks/useSettings';
import { useUser } from '@/app/hooks/use-auth';
import { CreateFolderDialog } from '../Folders/CreateFolderDialog';
import { AddFromUrlDialog } from '../AddFromUrl/AddFromUrlDialog';
import { UploadFilesDialog } from '../UploadKnowledge/UploadFilesDialog';
import { getFolderPiiPolicy } from '@/app/actions/folders';
import { getPiiIngestionModeAction } from '@/app/actions';
import type { PiiPolicyValue } from '../PiiPolicySelect';
import { getTeams } from '@/app/actions/teams';
import { getOrgMembersAndTeams } from '@/app/actions/permissions';
import {
  bulkDeleteFilesAction,
  bulkReembedFilesAction,
  bulkUpdatePiiPolicyAction,
} from '@/app/actions/bulk-documents';
import { useRouter, usePathname } from '@/i18n/routing';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@ragenai/common-ui/EmptyState';

import { FileSearch } from './FileSearch';
import { GridView } from './Grid/GridView';
import { LayoutToggle, getSavedViewMode } from './LayoutToggle';
import { useBulkSelection } from './hooks/useBulkSelection';
import { BulkActionBar } from './BulkActionBar';
import {
  BulkProgressBanner,
  type BulkProgressState,
} from './BulkProgressBanner';
import { ConfirmBulkDeleteDialog } from './ConfirmBulkDeleteDialog';
import { BulkPolicyDialog } from './BulkPolicyDialog';
import { MoveDialog } from '../MoveDialog';
import { ShareDialog } from '../ShareDialog';
import { DocumentPreviewSlideOver } from '../DocumentPreview/DocumentPreviewSlideOver';
import type { UserFileTypeSafe } from './FileList/UserFilesTable';
import {
  DocumentsTableWithFilters,
  DocumentsGridWithFilters,
} from './FileList/DocumentsTableWithFilters';

import { type UserFile } from '@/generated/prisma/browser';
import type { TeamListItem } from '@/features/teams/contracts/team.types';
import type {
  PaginatedUserFilesResult,
  UserFilesSort,
  UserFilesSortDir,
  DocumentFolderItem,
} from '@/features/documents/contracts/document.types';
import type {
  FileType,
  EmbeddingStatus,
  PiiPolicy,
} from '@/generated/prisma/browser';
import { clearFileFilterParams } from '@/features/documents/constants/file-filters';
import { isFileDrag } from '@/features/documents/constants/file-drag';
import { useOrgFeature } from '@/app/hooks/useOrgFeatures';

const BULK_PROGRESS_THRESHOLD = 10;

export type ModalStateProps = {
  isOpen: boolean;
  fileId: UserFile['id'] | null;
};

type FileListWrapperWithDataProps = {
  result: PaginatedUserFilesResult;
  sort: UserFilesSort;
  dir: UserFilesSortDir;
  selectedFileTypes: FileType[];
  selectedStatuses: EmbeddingStatus[];
  selectedPolicies: PiiPolicy[];
  topBarLeft?: React.ReactNode;
  /**
   * The page's title block. It shares a row with New folder / Add document,
   * which is why it is passed in rather than rendered by the page above:
   * the actions belong to this component and splitting the row across two
   * would leave them unable to sit on one line.
   */
  heading?: React.ReactNode;
  canManageOrg?: boolean;
  /**
   * The folders directly inside the one being shown, rendered ahead of the
   * files in both views.
   *
   * The folder filter is an exact match, not a subtree: standing in
   * "Contracts" you see the files filed in Contracts and nothing from
   * "Contracts / 2026". Without these, the only way into a subfolder is the
   * rail — and the rail is the one thing on this page that does not say what
   * it is nested inside.
   */
  subfolders?: DocumentFolderItem[];
  onNavigateFolder?: (folderId: string) => void;
};

export const FileListWrapperWithData = ({
  result,
  sort,
  dir,
  selectedFileTypes,
  selectedStatuses,
  selectedPolicies,
  topBarLeft,
  heading,
  canManageOrg,
  subfolders,
  onNavigateFolder,
}: FileListWrapperWithDataProps) => {
  const { successToast, errorToast, warningToast } = statusToast();
  const tSuccess = useTranslations('success-toast');
  const tError = useTranslations('error-toast');
  const tFolders = useTranslations('folders');
  const tBulk = useTranslations('bulk-notifications');
  const { user } = useUser();
  const [layoutMode, setLayoutMode] = useState<'list' | 'grid'>('list');
  const [searchValue, setSearchValue] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showModal, setShowModal] = useState<ModalStateProps>({
    isOpen: false,
    fileId: null,
  });
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isAddFromUrlOpen, setIsAddFromUrlOpen] = useState(false);
  // Hiding only. The server refuses these operations regardless — see
  // `assertCanManageDocuments` — but a demo visitor should not be shown an
  // "Add document" button that answers with an error.
  const canManageDocuments = useOrgFeature('manageDocuments');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadPiiPolicy, setUploadPiiPolicy] =
    useState<PiiPolicyValue>('TOXIC_ONLY');
  const [isUploading, setIsUploading] = useState(false);
  const [isDualContent, setIsDualContent] = useState(false);
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const bulk = useBulkSelection();
  const [bulkProgress, setBulkProgress] = useState<BulkProgressState>({
    status: 'idle',
  });
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isBulkMoveOpen, setIsBulkMoveOpen] = useState(false);
  const [isBulkShareOpen, setIsBulkShareOpen] = useState(false);
  const [isBulkPolicyOpen, setIsBulkPolicyOpen] = useState(false);
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<UserFileTypeSafe | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const [singleMoveFileId, setSingleMoveFileId] = useState<string | null>(null);
  const [singleMoveFileName, setSingleMoveFileName] = useState<string>('');
  const [singleShareFileId, setSingleShareFileId] = useState<string | null>(
    null,
  );
  const [singleShareFileName, setSingleShareFileName] = useState<string>('');
  const [orgMembers, setOrgMembers] = useState<
    { id: string; name: string | null; email: string }[]
  >([]);
  const [orgTeams, setOrgTeams] = useState<{ id: string; name: string }[]>([]);

  const { addFile, removeFile, currentFolderId, viewMode } =
    useUserFilesContext();

  const isSharedView = viewMode === 'shared-with-me';

  useEffect(() => {
    const saved = getSavedViewMode();
    if (saved !== 'list') {
      setLayoutMode(saved);
    }
  }, []);

  useEffect(() => {
    getPiiIngestionModeAction().then((mode) => {
      setIsDualContent(mode === 'dual_content');
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !previewFile) {
        toggleModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewFile]);

  useEffect(() => {
    getTeams()
      .then(setTeams)
      .catch(() => {});
  }, []);

  useEffect(() => {
    getOrgMembersAndTeams()
      .then(({ members, teams: t }) => {
        setOrgMembers(members);
        setOrgTeams(t);
      })
      .catch(() => {});
  }, []);

  const { refreshSettings } = useSettings();

  const toggleModal = (fileId: UserFile['id'] | null = null) => {
    setShowModal((prevState) => ({
      ...prevState,
      isOpen: !prevState.isOpen,
      fileId: prevState.isOpen ? null : fileId,
    }));
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(event.target.value.trim());
  };

  const filteredFiles = useMemo(() => {
    return result.items.filter((file) =>
      file.fileName.toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [result.items, searchValue]);

  const handlePreviewFile = (file: UserFileTypeSafe) => {
    const idx = filteredFiles.findIndex((f) => f.id === file.id);
    setPreviewFile(file);
    setPreviewIndex(idx >= 0 ? idx : 0);
  };

  const handleDelete = async (
    fileId: UserFile['id'],
    fileName: UserFile['fileName'],
  ) => {
    try {
      setDeleteLoading(true);
      const { status } = await deleteFileAction(fileId);

      if (status === 200) {
        removeFile(fileId);
        refreshSettings();
        router.refresh();
        successToast({ message: `${tSuccess('deleted')}: ${fileName}` });
      }
    } catch {
      errorToast({ message: tError('error-during-deleting-file') });
    } finally {
      setDeleteLoading(false);
    }
  };

  useEffect(() => {
    const visibleIds = filteredFiles.map((f) => f.id);
    bulk.retainOnly(visibleIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId, viewMode, filteredFiles]);

  const fileIds = useMemo(
    () => Array.from(bulk.selectedIds),
    [bulk.selectedIds],
  );

  /**
   * What a drag started on one row should carry.
   *
   * Dragging a row that is part of the current selection moves the whole
   * selection; dragging one outside it moves just that row and leaves the
   * selection alone. That is what every file manager does, and the
   * alternative — always moving one file — makes the selection checkboxes
   * look like they do nothing.
   */
  const handleDragFiles = useCallback(
    (fileId: string) =>
      bulk.isSelected(fileId) && fileIds.length > 0 ? fileIds : [fileId],
    [bulk, fileIds],
  );

  const handleBulkDelete = async () => {
    setIsBulkDeleteOpen(false);
    setIsBulkLoading(true);
    const count = fileIds.length;
    if (count >= BULK_PROGRESS_THRESHOLD) {
      setBulkProgress({ status: 'running', total: count, operation: 'delete' });
    }
    try {
      const deleteResult = await bulkDeleteFilesAction(fileIds);
      deleteResult.succeeded.forEach((id) => removeFile(id));
      if (deleteResult.succeeded.length > 0) {
        refreshSettings();
      }
      if (count >= BULK_PROGRESS_THRESHOLD) {
        setBulkProgress({
          status: 'done',
          succeeded: deleteResult.succeeded.length,
          failed: deleteResult.failed.length,
          operation: 'delete',
        });
      } else if (deleteResult.failed.length > 0) {
        warningToast({
          message: tBulk('deleted-partial', {
            succeeded: deleteResult.succeeded.length,
            total: count,
          }),
        });
      } else {
        successToast({
          message: tBulk('deleted-all', {
            count: deleteResult.succeeded.length,
          }),
        });
      }
      bulk.clearAll();
      router.refresh();
    } catch {
      errorToast({ message: tError('error-during-deleting-file') });
      if (count >= BULK_PROGRESS_THRESHOLD) {
        setBulkProgress({ status: 'idle' });
      }
    } finally {
      setIsBulkLoading(false);
    }
  };

  const handleBulkMoved = (
    succeeded: string[],
    failed: { fileId: string; fileName: string; error: string }[],
  ) => {
    const count = succeeded.length + failed.length;
    if (count >= BULK_PROGRESS_THRESHOLD) {
      setBulkProgress({
        status: 'done',
        succeeded: succeeded.length,
        failed: failed.length,
        operation: 'move',
      });
    } else if (failed.length > 0) {
      warningToast({
        message: tBulk('moved-partial', {
          succeeded: succeeded.length,
          total: count,
        }),
      });
    } else {
      successToast({
        message: tBulk('moved-all', { count: succeeded.length }),
      });
    }
    bulk.clearAll();
    router.refresh();
  };

  const handleBulkShared = (
    succeeded: string[],
    failed: { fileId: string; fileName: string; error: string }[],
  ) => {
    const count = succeeded.length + failed.length;
    if (failed.length > 0) {
      warningToast({
        message: tBulk('shared-partial', {
          succeeded: succeeded.length,
          total: count,
        }),
      });
    } else {
      successToast({
        message: tBulk('shared-all', { count: succeeded.length }),
      });
    }
    bulk.clearAll();
  };

  /**
   * Reprocess a given set, rather than whatever is selected.
   *
   * The selection is the usual argument, but a policy change reprocesses only
   * the files whose policy actually changed — a set the selection no longer
   * describes once any of them failed.
   */
  const runBulkReembed = async (ids: string[]) => {
    setIsBulkLoading(true);
    const count = ids.length;
    if (count >= BULK_PROGRESS_THRESHOLD) {
      setBulkProgress({
        status: 'running',
        total: count,
        operation: 'reembed',
      });
    }
    try {
      const reembedResult = await bulkReembedFilesAction(ids);
      if (count >= BULK_PROGRESS_THRESHOLD) {
        setBulkProgress({
          status: 'done',
          succeeded: reembedResult.succeeded.length,
          failed: reembedResult.failed.length,
          operation: 'reembed',
        });
      } else if (reembedResult.failed.length > 0) {
        warningToast({
          message: tBulk('reembedded-partial', {
            succeeded: reembedResult.succeeded.length,
            total: count,
          }),
        });
      } else {
        successToast({
          message: tBulk('reembedded-all', {
            count: reembedResult.succeeded.length,
          }),
        });
      }
      bulk.clearAll();
      router.refresh();
    } catch {
      errorToast({ message: tBulk('reembed-error') });
      if (count >= BULK_PROGRESS_THRESHOLD) {
        setBulkProgress({ status: 'idle' });
      }
    } finally {
      setIsBulkLoading(false);
    }
  };

  const handleBulkReembed = () => runBulkReembed(fileIds);

  const handleBulkChangePolicy = async (
    policy: PiiPolicyValue,
    reprocess: boolean,
  ) => {
    setIsBulkLoading(true);
    const count = fileIds.length;
    try {
      const policyResult = await bulkUpdatePiiPolicyAction(
        fileIds,
        policy as PiiPolicy,
      );

      if (policyResult.failed.length > 0) {
        warningToast({
          message: tBulk('policy-partial', {
            succeeded: policyResult.succeeded.length,
            total: count,
          }),
        });
      } else {
        successToast({
          message: tBulk('policy-all', {
            count: policyResult.succeeded.length,
          }),
        });
      }

      setIsBulkPolicyOpen(false);

      // Only the files that took the new policy are worth reprocessing —
      // reparsing the ones that failed to change would spend the work and
      // land on the old policy.
      //
      // Not an early return: `runBulkReembed` clears and refreshes on its way
      // out, but not when it catches. The policy changed either way, so the
      // table has to show it and the selection it was made on has to go —
      // leaving both would put a stale selection over stale rows and blame
      // the reprocess for it.
      if (reprocess && policyResult.succeeded.length > 0) {
        await runBulkReembed(policyResult.succeeded);
      }

      bulk.clearAll();
      router.refresh();
    } catch {
      errorToast({ message: tBulk('policy-error') });
    } finally {
      setIsBulkLoading(false);
    }
  };

  const handleUploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const filesArray = Array.from(fileList).map((file) => {
        if (file.name.endsWith('.md')) {
          return new File([file], file.name, { type: 'text/markdown' });
        }
        if (file.name.endsWith('.srt')) {
          return new File([file], file.name, { type: 'application/x-subrip' });
        }
        return file;
      });
      if (filesArray.length === 0) {
        return;
      }

      let defaultPolicy: PiiPolicyValue = 'TOXIC_ONLY';
      if (currentFolderId) {
        try {
          const folderPolicy = await getFolderPiiPolicy(currentFolderId);
          defaultPolicy = folderPolicy as PiiPolicyValue;
        } catch {
          // No folder policy set — fall through to the organization default.
        }
      }

      setPendingFiles(filesArray);
      setUploadPiiPolicy(defaultPolicy);
      setIsUploadDialogOpen(true);
    },
    [currentFolderId],
  );

  const handleUploadSubmit = useCallback(
    async (piiPolicy: PiiPolicyValue) => {
      if (pendingFiles.length === 0) {
        return;
      }

      setIsUploading(true);
      try {
        const formData = new FormData();
        pendingFiles.forEach((file) => formData.append('files', file));
        if (currentFolderId) {
          formData.append('folderId', String(currentFolderId));
        }
        formData.append('pii_policy', piiPolicy);

        const response = await uploadFilesApi(formData);
        if (response.status === 200) {
          successToast({
            message: tSuccess('files-uploaded', {
              count: response.files?.length ?? pendingFiles.length,
            }),
          });
          setPendingFiles([]);
          setIsUploadDialogOpen(false);
          router.refresh();
          refreshSettings();
        } else {
          errorToast({ message: response.message || 'Upload failed' });
        }
      } catch (err) {
        errorToast({
          message: err instanceof Error ? err.message : 'Error uploading files',
        });
      } finally {
        setIsUploading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      pendingFiles,
      currentFolderId,
      router,
      refreshSettings,
      successToast,
      errorToast,
    ],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (isFileDrag(e.dataTransfer)) {
        return;
      }
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleUploadFiles(e.dataTransfer.files);
      }
    },
    [handleUploadFiles],
  );

  const handleResetFilters = useCallback(() => {
    const params = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : '',
    );
    clearFileFilterParams(params);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname]);

  /*
    A row being dragged onto a folder passes over this zone on its way there.
    Without the check it lights up as "drop files to upload" the whole time,
    which promises the wrong operation — and calling `preventDefault` on it
    would make this zone a drop target for a move it cannot perform.
  */
  const handleDragOver = (e: React.DragEvent) => {
    if (isFileDrag(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  if (!user) {
    return null;
  }

  const hasServerContent = result.items.length > 0;
  const hasActiveFilters =
    selectedFileTypes.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedPolicies.length > 0;
  const isTrulyEmpty = !hasServerContent && !hasActiveFilters;
  const isFilteredEmpty = !hasServerContent && hasActiveFilters;
  const isSearchEmpty = hasServerContent && filteredFiles.length === 0;

  /*
    Search, the view toggle and the selection bar all belong to the filter
    row, so they are handed to it rather than stacked above it. The three used
    to sit in rows of their own between the title and the table, which put
    four horizontal bands over a five-row table and left the selection count
    two bands away from the checkboxes that produced it.

    They render only alongside a table or a grid — an empty knowledge base has
    nothing to search, draw differently or select.
  */
  const searchNode = (
    <FileSearch value={searchValue} onChange={handleSearchChange} />
  );

  const viewToggleNode = (
    <LayoutToggle
      className="hidden md:flex"
      viewMode={layoutMode}
      onViewModeChange={setLayoutMode}
    />
  );

  const selectionBarNode = (
    <BulkActionBar
      selectedCount={bulk.selectedCount}
      onClear={bulk.clearAll}
      onDelete={() => setIsBulkDeleteOpen(true)}
      onMove={() => setIsBulkMoveOpen(true)}
      onShare={() => setIsBulkShareOpen(true)}
      onChangePolicy={() => setIsBulkPolicyOpen(true)}
      canChangePolicy={canManageOrg === true}
      onReembed={handleBulkReembed}
      isLoading={isBulkLoading}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        Title and the two actions on one row. Everything that narrows or
        redraws the table lives in the filter row below, so this row holds
        only the name of the place and the two ways to add to it.
      */}
      <div
        className={
          heading || (!isSharedView && canManageDocuments)
            ? 'mb-3 flex shrink-0 items-start gap-3'
            : 'hidden'
        }
      >
        {heading}
        <div className="flex-1" />
        {!isSharedView && canManageDocuments && (
          <>
            <button
              onClick={() => setIsCreateFolderOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors dark:bg-muted dark:hover:bg-paper-700"
            >
              <FolderPlusIcon className="size-4" />
              {tFolders('new')}
            </button>
            {/*
              `modal={false}` is load-bearing, not a preference. Radix locks
              the page while an open menu is modal — `pointer-events: none` on
              the body plus a focus trap — where Headless UI did not. Both
              menus here lead to a dialog or a file picker that appears while
              the menu is still open, and under the default the dialog's own
              buttons render visible and refuse to be clicked.
              smoke-10-knowledge-upload caught exactly that.
            */}
            <DropdownMenu modal={false}>
              {/*
                `color="violet"` is gone rather than translated. It was one of
                three competing accents in an app whose brand is navy and
                crimson, and shadcn's default button is `bg-primary` — which
                is the brand navy since the palette landed.

                Icons carry no `data-slot="icon"` either: that existed so the
                old menu could select them for spacing. shadcn's item lays out
                its children with flex and a gap.
              */}
              <DropdownMenuTrigger asChild>
                <Button className="inline-flex items-center gap-2">
                  {tFolders('add-document')}
                  <ChevronDownIcon className="size-3.5 ml-0.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <ComputerDesktopIcon className="size-4" />
                  {tFolders('from-disk')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push('/knowledge/create-document')}
                >
                  <DocumentPlusIcon className="size-4" />
                  {tFolders('create-document')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsAddFromUrlOpen(true)}>
                  <GlobeAltIcon className="size-4" />
                  {tFolders('add-from-url')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push('/knowledge/optimize-document')}
                >
                  <SparklesIcon className="size-4" />
                  {tFolders('optimize-document')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
          </>
        )}
      </div>

      {topBarLeft && <div className="mb-2 shrink-0">{topBarLeft}</div>}

      <BulkProgressBanner
        state={bulkProgress}
        onDismiss={() => setBulkProgress({ status: 'idle' })}
      />

      {/*
        The drop target, and nothing else. It used to be the page's scroller
        too — one `overflow-y-auto` box with a 2px dashed edge and an 8px
        radius, holding the toolbar, the table and the pager together — which
        put a second scrollbar and a second rounded border inside a panel that
        is already a card, and read as an embedded widget rather than as the
        page. The scrolling moved down to the table and the grid; this element
        keeps the handlers and the highlight.

        Still `border-dashed`, transparent at rest: the border reserves its own
        space, so the highlight appearing on drag-over tints and outlines
        without shifting a single row. 1px rather than 2px — panels here are
        line drawings.
      */}
      <div
        data-testid="documents-drop-zone"
        className={`relative flex min-h-0 flex-1 flex-col rounded-md border border-dashed transition-colors ${
          isDragOver && !isSharedView
            ? 'bg-brand-50 border-brand-300 dark:bg-brand-900/20 dark:border-brand-600'
            : 'border-transparent'
        }`}
        onDrop={isSharedView ? undefined : handleDrop}
        onDragOver={isSharedView ? undefined : handleDragOver}
        onDragLeave={isSharedView ? undefined : handleDragLeave}
      >
        {isTrulyEmpty && isSharedView && (
          <EmptyState title={tFolders('no-shared-files')} className="py-20" />
        )}
        {isTrulyEmpty && !isSharedView && !canManageDocuments && (
          <EmptyState
            title={tFolders(
              currentFolderId ? 'no-documents-in-folder' : 'no-documents',
            )}
            className="py-20"
          />
        )}
        {isTrulyEmpty && !isSharedView && canManageDocuments && (
          <EmptyState
            icon={<ArrowUpTrayIcon className="size-10 text-muted-foreground" />}
            title={tFolders(
              currentFolderId ? 'no-documents-in-folder' : 'no-documents',
            )}
            description={tFolders('drag-drop')}
            actions={[
              {
                label: tFolders('upload-cta'),
                onClick: () => fileInputRef.current?.click(),
              },
              {
                label: tFolders('create-document'),
                onClick: () => router.push('/knowledge/create-document'),
              },
              {
                label: tFolders('add-from-url'),
                onClick: () => setIsAddFromUrlOpen(true),
              },
            ]}
            className="py-20"
          />
        )}
        {(hasServerContent || isFilteredEmpty) && layoutMode === 'grid' && (
          <DocumentsGridWithFilters
            result={result}
            sort={sort}
            dir={dir}
            selectedFileTypes={selectedFileTypes}
            selectedStatuses={selectedStatuses}
            selectedPolicies={selectedPolicies}
            search={searchNode}
            viewToggle={viewToggleNode}
            selectionBar={selectionBarNode}
          >
            {isSearchEmpty ? (
              <EmptyState
                icon={
                  <MagnifyingGlassIcon className="size-10 text-muted-foreground" />
                }
                title={tFolders('no-search-results', { query: searchValue })}
                className="py-20"
              />
            ) : (
              <GridView
                deleteLoading={deleteLoading}
                isError={false}
                isLoading={false}
                addFile={addFile}
                showModal={showModal}
                removeFile={removeFile}
                files={filteredFiles}
                subfolders={subfolders ?? []}
                onNavigateFolder={onNavigateFolder}
                onDragFiles={handleDragFiles}
                toggleModal={toggleModal}
                handleDelete={handleDelete}
                isSelected={bulk.isSelected}
                isAllSelected={bulk.isAllSelected}
                isIndeterminate={bulk.isIndeterminate}
                onToggleFile={bulk.toggleFile}
                onToggleAll={bulk.toggleAll}
                onUpload={
                  !isSharedView
                    ? () => fileInputRef.current?.click()
                    : undefined
                }
                onCreateDocument={
                  !isSharedView
                    ? () => router.push('/knowledge/create-document')
                    : undefined
                }
                onAddFromUrl={
                  !isSharedView ? () => setIsAddFromUrlOpen(true) : undefined
                }
                onPreviewFile={handlePreviewFile}
                onMove={(fileId) => {
                  const f = filteredFiles.find((x) => x.id === fileId);
                  setSingleMoveFileId(fileId);
                  setSingleMoveFileName(f?.fileName ?? '');
                }}
                onShare={(fileId) => {
                  const f = filteredFiles.find((x) => x.id === fileId);
                  setSingleShareFileId(fileId);
                  setSingleShareFileName(f?.fileName ?? '');
                }}
                isFilteredEmpty={isFilteredEmpty}
                onResetFilters={
                  isFilteredEmpty ? handleResetFilters : undefined
                }
                canManageOrg={canManageOrg}
              />
            )}
          </DocumentsGridWithFilters>
        )}
        {(hasServerContent || isFilteredEmpty) && layoutMode === 'list' && (
          <DocumentsTableWithFilters
            result={result}
            files={filteredFiles}
            subfolders={subfolders}
            onNavigateFolder={onNavigateFolder}
            onDragFiles={handleDragFiles}
            sort={sort}
            dir={dir}
            selectedFileTypes={selectedFileTypes}
            selectedStatuses={selectedStatuses}
            selectedPolicies={selectedPolicies}
            search={searchNode}
            viewToggle={viewToggleNode}
            selectionBar={selectionBarNode}
            showModal={showModal}
            deleteLoading={deleteLoading}
            toggleModal={toggleModal}
            addFile={addFile}
            removeFile={removeFile}
            handleDelete={handleDelete}
            isSelected={bulk.isSelected}
            isAllSelected={bulk.isAllSelected}
            isIndeterminate={bulk.isIndeterminate}
            onToggleFile={bulk.toggleFile}
            onToggleAll={bulk.toggleAll}
            onUpload={
              !isSharedView ? () => fileInputRef.current?.click() : undefined
            }
            onCreateDocument={
              !isSharedView
                ? () => router.push('/knowledge/create-document')
                : undefined
            }
            onAddFromUrl={
              !isSharedView ? () => setIsAddFromUrlOpen(true) : undefined
            }
            onPreviewFile={handlePreviewFile}
            canManageOrg={canManageOrg}
          />
        )}
      </div>

      <DocumentPreviewSlideOver
        file={previewFile}
        files={filteredFiles as UserFileTypeSafe[]}
        initialIndex={previewIndex}
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
        onFileChange={(f, i) => {
          setPreviewFile(f);
          setPreviewIndex(i);
        }}
        onDelete={(fileId) => {
          toggleModal(fileId);
          setPreviewFile(null);
        }}
        onShare={(fileId) => {
          const f = filteredFiles.find((x) => x.id === fileId);
          setPreviewFile(null);
          setSingleShareFileId(fileId);
          setSingleShareFileName(f?.fileName ?? '');
        }}
        onMove={(fileId) => {
          const f = filteredFiles.find((x) => x.id === fileId);
          setPreviewFile(null);
          setSingleMoveFileId(fileId);
          setSingleMoveFileName(f?.fileName ?? '');
        }}
      />

      <UploadFilesDialog
        isOpen={isUploadDialogOpen}
        files={pendingFiles}
        initialPiiPolicy={uploadPiiPolicy}
        isUploading={isUploading}
        isDualContent={isDualContent}
        onClose={() => {
          setIsUploadDialogOpen(false);
          setPendingFiles([]);
        }}
        onRemoveFile={(index) =>
          setPendingFiles((prev) => prev.filter((_, i) => i !== index))
        }
        onSubmit={handleUploadSubmit}
      />

      <CreateFolderDialog
        isOpen={isCreateFolderOpen}
        onClose={() => setIsCreateFolderOpen(false)}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        onCreated={() => {
          setIsCreateFolderOpen(false);
          router.refresh();
        }}
        parentId={currentFolderId}
      />

      <AddFromUrlDialog
        isOpen={isAddFromUrlOpen}
        onClose={() => setIsAddFromUrlOpen(false)}
        onSuccess={() => {
          setIsAddFromUrlOpen(false);
          router.refresh();
        }}
      />

      <ConfirmBulkDeleteDialog
        isOpen={isBulkDeleteOpen}
        isLoading={isBulkLoading}
        count={bulk.selectedCount}
        onClose={() => setIsBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
      />

      <BulkPolicyDialog
        isOpen={isBulkPolicyOpen}
        isLoading={isBulkLoading}
        count={bulk.selectedCount}
        onClose={() => setIsBulkPolicyOpen(false)}
        onConfirm={handleBulkChangePolicy}
      />

      <MoveDialog
        mode="bulk"
        isOpen={isBulkMoveOpen}
        onClose={() => setIsBulkMoveOpen(false)}
        fileIds={fileIds}
        onMoved={handleBulkMoved}
      />

      {singleMoveFileId && (
        <MoveDialog
          mode="single"
          resourceType="file"
          resourceId={singleMoveFileId}
          resourceName={singleMoveFileName}
          isOpen={!!singleMoveFileId}
          onClose={() => setSingleMoveFileId(null)}
          onMoved={() => {
            setSingleMoveFileId(null);
            router.refresh();
          }}
        />
      )}

      <ShareDialog
        mode="bulk"
        isOpen={isBulkShareOpen}
        onClose={() => setIsBulkShareOpen(false)}
        fileIds={fileIds}
        orgMembers={orgMembers}
        orgTeams={orgTeams}
        onShared={handleBulkShared}
      />

      {singleShareFileId && (
        <ShareDialog
          mode="single"
          resourceType="file"
          resourceId={singleShareFileId}
          resourceName={singleShareFileName}
          isOpen={!!singleShareFileId}
          onClose={() => setSingleShareFileId(null)}
          orgMembers={orgMembers}
          orgTeams={orgTeams}
        />
      )}
    </div>
  );
};
