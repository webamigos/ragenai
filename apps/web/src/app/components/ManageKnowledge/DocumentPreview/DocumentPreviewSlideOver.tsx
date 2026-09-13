'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { UserFileTypeSafe } from '../UserFiles/FileList/UserFilesTable';
import { Scrim } from '@/components/ui/scrim';
import { useDocumentPreview } from './hooks/useDocumentPreview';
import { DocumentPreviewHeader } from './DocumentPreviewHeader';
import { DocumentPreviewMetadata } from './DocumentPreviewMetadata';
import { ViewerForType } from './viewers/ViewerForType';

type Props = {
  file: UserFileTypeSafe | null;
  files: UserFileTypeSafe[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onFileChange: (file: UserFileTypeSafe, index: number) => void;
  onDelete: (fileId: string) => void;
  onShare: (fileId: string) => void;
  onMove: (fileId: string) => void;
};

export function DocumentPreviewSlideOver({
  file,
  files,
  initialIndex,
  isOpen,
  onClose,
  onFileChange,
  onDelete,
  onShare,
  onMove,
}: Props) {
  const { contentUrl, goNext, goPrev, canGoNext, canGoPrev } =
    useDocumentPreview({
      file: file ?? files[0],
      files,
      initialIndex,
      isOpen,
      onFileChange,
    });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !file) {
    return null;
  }

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `/api/files/${file.id}`;
    link.download = file.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay */}
      <Scrim data-testid="preview-overlay" onClick={onClose} />

      {/* Panel */}
      <div className="relative flex h-full w-[90vw] max-w-5xl flex-col bg-card shadow-2xl dark:bg-muted">
        {/* Header */}
        <DocumentPreviewHeader
          fileName={file.fileName}
          fileType={file.fileType}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onPrev={goPrev}
          onNext={goNext}
          onClose={onClose}
        />

        {/* Body: viewer 70% + metadata 30% */}
        <div className="flex min-h-0 flex-1">
          {/* Viewer */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <ViewerForType
              fileType={file.fileType}
              fileId={file.id}
              fileName={file.fileName}
              contentUrl={contentUrl}
            />
          </div>

          {/* Metadata sidebar */}
          <div className="hidden w-72 shrink-0 border-l border-border lg:flex lg:flex-col">
            <DocumentPreviewMetadata
              file={file}
              onDownload={handleDownload}
              onShare={() => onShare(file.id)}
              onMove={() => onMove(file.id)}
              onDelete={() => onDelete(file.id)}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
