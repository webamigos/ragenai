import { format } from 'date-fns';
import prettyBytes from 'pretty-bytes';
import { useTranslations } from 'next-intl';

import { truncateFileName } from '@/app/lib/utils/truncateFileName';
import { getFileIcon } from '@/app/lib/constants/fileIcons';
import { Text } from '@ragenai/common-ui/Text';
import { setDraggedFileIds } from '@/features/documents/constants/file-drag';
import { Tooltip } from '@ragenai/common-ui/Tooltip';
import { Link } from '@/i18n/routing';

import type { UserFileTypeSafe } from '../FileList/UserFilesTable';
import { RagScoreBadge } from '../FileList/RagScoreBadge';
import { ToolbarActions } from '../FileList/ToolbarActions';
import { PiiPolicyBadge } from '../../PiiPolicyBadge';

type Props = {
  file: UserFileTypeSafe;
  isLoading: boolean;
  deleteLoading?: boolean;
  toggleModal: (fileId: string | null) => void;
  isSelected?: boolean;
  onToggleFile?: (id: string) => void;
  onPreviewFile?: (file: UserFileTypeSafe) => void;
  /** See `FileRowProps.onDragFiles` in `UserFilesTable`. */
  onDragFiles?: (fileId: string) => string[];
  onMove?: (fileId: string) => void;
  onShare?: (fileId: string) => void;
  onScore?: (fileId: string) => void;
  isScoringLoading?: boolean;
  canManageOrg?: boolean;
};

export const FileCard = ({
  file,
  isLoading,
  deleteLoading,
  toggleModal,
  isSelected,
  onToggleFile,
  onPreviewFile,
  onDragFiles,
  onMove,
  onShare,
  onScore,
  isScoringLoading,
  canManageOrg,
}: Props) => {
  const tBulkBar = useTranslations('bulk-action-bar');
  const {
    fileName,
    fileSize,
    fileType,
    id: fileIdVal,
    createdAt,
    document,
  } = file;

  const fileIcon = getFileIcon(fileType);
  const formattedCreatedAt = createdAt
    ? format(new Date(createdAt), 'yyyy-MM-dd')
    : '-';

  const hasThumbnail = !!file.thumbnailS3Key;
  const isPdf = fileType === 'PDF';
  const documentLink = document?.id ? `/document/${document.id}` : undefined;

  const isImage = fileType === 'IMAGE';

  const renderPreview = () => {
    if (isImage) {
      return (
        <img
          src={`/api/files/${fileIdVal}`}
          alt={`Preview of ${fileName}`}
          className="w-full h-full object-contain p-2"
          loading="lazy"
        />
      );
    }

    if (hasThumbnail) {
      return (
        <img
          src={`/api/files/${fileIdVal}/thumbnail`}
          alt={`Preview of ${fileName}`}
          className="w-full h-full object-cover object-top"
          loading="lazy"
        />
      );
    }

    if (isPdf && fileIdVal) {
      return (
        <div className="w-full h-full overflow-hidden pointer-events-none">
          <iframe
            src={`/api/files/${fileIdVal}#navpanes=0&toolbar=0&view=FitH&scrollbar=0`}
            className="w-[300%] h-[300%] border-0 origin-top-left scale-[0.35] -mt-[3%] -ml-[1%]"
            title={`Preview ${fileName}`}
            tabIndex={-1}
          />
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center text-5xl opacity-30">
        {fileIcon}
      </div>
    );
  };

  return (
    <div
      className={`flex flex-col bg-muted dark:bg-paper-800 rounded-lg shadow-sm overflow-hidden group relative cursor-pointer${isSelected ? ' outline outline-2 outline-ring' : ''}`}
      data-testid={`file-card-${fileIdVal}`}
      onClick={() => onPreviewFile?.(file)}
      // Draggable onto a folder in the rail, same gesture as a table row.
      draggable={onDragFiles !== undefined}
      onDragStart={(event) => {
        if (!onDragFiles) {
          return;
        }
        setDraggedFileIds(event.dataTransfer, onDragFiles(fileIdVal));
      }}
    >
      <div className="px-3 py-2 flex items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-1">
          <span className="shrink-0">{fileIcon}</span>
          <Tooltip
            delayShow={1000}
            place="top"
            content={fileName}
            id={`tooltip-${fileIdVal}`}
          >
            {document?.id ? (
              <Link
                href={`/document/${document.id}`}
                title={fileName}
                className="block truncate text-xs text-brand-600 hover:underline dark:text-brand-400"
                onClick={(e) => e.stopPropagation()}
              >
                {truncateFileName(fileName, 35)}
              </Link>
            ) : (
              <Text fontSize="xs" className="block truncate">
                {truncateFileName(fileName, 35)}
              </Text>
            )}
          </Tooltip>
        </div>
        {onToggleFile && (
          <input
            type="checkbox"
            checked={!!isSelected}
            onChange={() => onToggleFile(fileIdVal)}
            onClick={(e) => e.stopPropagation()}
            aria-label={tBulkBar('select-file', { fileName })}
            data-testid={`file-card-checkbox-${fileIdVal}`}
            className="size-4 shrink-0 cursor-pointer rounded border-border accent-primary"
          />
        )}
      </div>

      <div className="relative mx-3 mb-1 bg-card dark:bg-paper-600 rounded overflow-hidden aspect-[1/1.3]">
        {renderPreview()}
        {/* Actions button — top-right corner on hover */}
        <div
          className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-150 [&_svg]:rotate-90"
          onClick={(e) => e.stopPropagation()}
        >
          <ToolbarActions
            fileId={fileIdVal}
            documentId={document?.id}
            fileName={fileName}
            toggleModal={toggleModal}
            isLoading={deleteLoading ?? isLoading}
            onMove={onMove}
            onShare={onShare}
            onScore={onScore}
            isScoringLoading={isScoringLoading}
          />
        </div>
        {documentLink && (
          <Link
            href={documentLink}
            className="absolute inset-0 z-0 group-hover:z-[-1]"
            aria-label={`Open ${fileName}`}
          />
        )}
      </div>

      <div className="px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {formattedCreatedAt}
          <RagScoreBadge metadata={file.metadata} />
          {canManageOrg && <PiiPolicyBadge piiPolicy={file.piiPolicy} />}
        </span>
        <span>{prettyBytes(fileSize)}</span>
      </div>
    </div>
  );
};
