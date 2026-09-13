'use client';

import { useTranslations } from 'next-intl';
import { EllipsisVerticalIcon } from '@heroicons/react/20/solid';
import {
  PencilSquareIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ArrowRightIcon,
  ShareIcon,
  ChartBarIcon,
  SparklesIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useRouter } from '@/i18n/routing';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

type ToolbarActionsProps = {
  fileId: string;
  documentId?: string;
  fileName: string;
  folderId?: number | null;
  toggleModal: (fileId: string | null) => void;
  onMove?: (fileId: string) => void;
  onShare?: (fileId: string) => void;
  onScore?: (fileId: string) => void;
  /**
   * Opens the confirmation dialog for this file's PII policy. Passed only to
   * someone who may change it — the item is absent otherwise rather than
   * disabled, because a disabled item in a menu is a promise you cannot keep.
   */
  onChangePolicy?: (fileId: string) => void;
  isScoringLoading?: boolean;
  isLoading: boolean;
};

export const ToolbarActions = ({
  fileId,
  documentId,
  fileName,
  toggleModal,
  onMove,
  onShare,
  onScore,
  onChangePolicy,
  isScoringLoading,
  isLoading,
}: ToolbarActionsProps) => {
  const t = useTranslations('files-table');
  const router = useRouter();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {/* `plain` becomes the ghost variant, which already carries the hover
            background the old classes were adding by hand. */}
        <Button
          variant="ghost"
          aria-label="Actions"
          className="!p-1.5 !rounded-md"
        >
          <EllipsisVerticalIcon className="size-5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="[&_[data-slot=icon]]:mr-2">
        {documentId && (
          <DropdownMenuItem
            onClick={() => router.push(`/document/${documentId}`)}
          >
            <EyeIcon className="size-4" />
            {t('view')}
          </DropdownMenuItem>
        )}

        {documentId && (
          <DropdownMenuItem
            onClick={() => router.push(`/document/${documentId}?edit=true`)}
          >
            <PencilSquareIcon className="size-4" />
            {t('edit')}
          </DropdownMenuItem>
        )}

        {fileId && (
          <DropdownMenuItem
            onClick={() => {
              const link = document.createElement('a');
              link.href = `/api/files/${fileId}`;
              link.download = fileName;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
          >
            <ArrowDownTrayIcon className="size-4" />
            {t('download')}
          </DropdownMenuItem>
        )}

        {fileId && onMove && (
          <DropdownMenuItem onClick={() => onMove(fileId)}>
            <ArrowRightIcon className="size-4" />
            {t('move') || 'Move'}
          </DropdownMenuItem>
        )}

        {/*
          The policy lives here rather than as a control in the row.

          Its column used to hold a live select: three keystrokes from a menu
          nobody opened on purpose and the file's masking had changed, with no
          confirmation and nothing said about the text already indexed under
          the old policy. It is a data-protection setting; it belongs behind
          the same deliberate step as Delete, with a dialog that says what
          happens to what is already in the index.
        */}
        {fileId && onChangePolicy && (
          <DropdownMenuItem onClick={() => onChangePolicy(fileId)}>
            <ShieldCheckIcon className="size-4" />
            {t('change-pii-policy')}
          </DropdownMenuItem>
        )}

        {fileId && onShare && (
          <DropdownMenuItem onClick={() => onShare(fileId)}>
            <ShareIcon className="size-4" />
            {t('share') || 'Share'}
          </DropdownMenuItem>
        )}

        {fileId && onScore && (
          <DropdownMenuItem
            onClick={() => onScore(fileId)}
            disabled={isScoringLoading}
          >
            <ChartBarIcon className="size-4" />
            {t('score-rag')}
          </DropdownMenuItem>
        )}

        {documentId && (
          <DropdownMenuItem
            onClick={() =>
              router.push(
                `/knowledge/documents/${documentId}?tab=optimize` as never,
              )
            }
          >
            <SparklesIcon className="size-4" />
            {t('optimize-rag')}
          </DropdownMenuItem>
        )}

        {fileId && <DropdownMenuSeparator />}

        {fileId && (
          <DropdownMenuItem
            onClick={() => toggleModal(fileId)}
            disabled={isLoading}
          >
            <TrashIcon className="!size-4 !text-destructive !fill-none !stroke-destructive" />
            <span className="text-destructive">{t('delete')}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
