'use client';

import { useTranslations } from 'next-intl';
import { Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';

export type BulkProgressState =
  | { status: 'idle' }
  | { status: 'running'; total: number; operation: string }
  | { status: 'done'; succeeded: number; failed: number; operation: string }
  | { status: 'error'; message: string };

type Props = {
  state: BulkProgressState;
  onDismiss: () => void;
};

export const BulkProgressBanner = ({ state, onDismiss }: Props) => {
  const t = useTranslations('bulk-progress-banner');

  if (state.status === 'idle') {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="bulk-progress-banner"
      // `shrink-0`: it sits in the file list's flex column, above the
      // scrolling rows. Without it a long message is compressed away rather
      // than taking the height it needs.
      className="mb-3 flex shrink-0 items-center gap-3 rounded-md border px-4 py-3 text-sm"
    >
      {state.status === 'running' && (
        <>
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="flex-1">
            {t('running', {
              operation: t(`op.${state.operation}`),
              total: state.total,
            })}
          </span>
        </>
      )}

      {state.status === 'done' && (
        <>
          {state.failed === 0 ? (
            <CheckCircle2 className="size-4 shrink-0 text-ready" />
          ) : (
            <AlertCircle className="size-4 shrink-0 text-pending" />
          )}
          <span className="flex-1">
            {state.failed === 0
              ? t('done-all', {
                  operation: t(`op.${state.operation}`),
                  count: state.succeeded,
                })
              : t('done-partial', {
                  operation: t(`op.${state.operation}`),
                  succeeded: state.succeeded,
                  failed: state.failed,
                })}
          </span>
          <button
            onClick={onDismiss}
            className="ml-2 text-muted-foreground hover:text-foreground"
            aria-label={t('dismiss')}
          >
            <X className="size-4" />
          </button>
        </>
      )}

      {state.status === 'error' && (
        <>
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <span className="flex-1 text-destructive">{state.message}</span>
          <button
            onClick={onDismiss}
            className="ml-2 text-muted-foreground hover:text-foreground"
            aria-label={t('dismiss')}
          >
            <X className="size-4" />
          </button>
        </>
      )}
    </div>
  );
};
