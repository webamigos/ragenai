'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HomeIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getFolderBreadcrumbs } from '@/app/actions/folders';
import type { BreadcrumbItem } from '@/features/documents/services/queries/get-folder-breadcrumbs-query';

type Props = {
  folderId: string | null;
  onNavigate: (folderId: string | null) => void;
  /**
   * `inline` is a trail in a band of its own, above the toolbar.
   *
   * `title` is the same trail standing in for the page's heading: the folder
   * you are in is the `<h1>`, and the way back out is the path in front of
   * it. A folder page used to carry both — a heading naming the scope and a
   * breadcrumb naming the folder — which is two horizontal bands saying
   * where you are, and the heading was the one that did not answer it.
   */
  variant?: 'inline' | 'title';
  /**
   * What the first crumb is called in the `title` variant. The rail calls
   * the root by the active scope ("All files", "My files"), so the trail has
   * to as well, or the two disagree about the place you are standing in.
   */
  rootLabel?: string;
};

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

type BreadcrumbSegments = {
  visible: BreadcrumbItem[];
  hidden: BreadcrumbItem[];
};

function useBreadcrumbSegments(
  breadcrumbs: BreadcrumbItem[],
  isMobile: boolean,
): BreadcrumbSegments {
  const maxVisible = isMobile ? 1 : 4;

  if (breadcrumbs.length <= maxVisible) {
    return { visible: breadcrumbs, hidden: [] };
  }

  return {
    visible: breadcrumbs.slice(breadcrumbs.length - maxVisible),
    hidden: breadcrumbs.slice(0, breadcrumbs.length - maxVisible),
  };
}

const separatorClass = 'text-muted-foreground shrink-0';
const segmentButtonClass =
  'max-w-[120px] truncate text-foreground hover:text-foreground/90 font-medium transition-colors';

/**
 * One crumb. The last one is the place you are standing in, so it is text
 * rather than a link — and in the `title` variant it is the page's `<h1>`,
 * not a `<span>` sitting beside a heading that says something else.
 */
function Segment({
  crumb,
  isLast,
  isTitle,
  onNavigate,
}: {
  crumb: BreadcrumbItem;
  isLast: boolean;
  isTitle: boolean;
  onNavigate: (folderId: string | null) => void;
}) {
  if (!isLast) {
    return (
      <button
        type="button"
        title={crumb.name}
        onClick={() => onNavigate(crumb.id)}
        className={segmentButtonClass}
      >
        {crumb.name}
      </button>
    );
  }

  if (isTitle) {
    return (
      <h1
        title={crumb.name}
        aria-current="page"
        className="min-w-0 truncate font-display text-xl font-semibold text-foreground"
      >
        {crumb.name}
      </h1>
    );
  }

  return (
    <span
      title={crumb.name}
      aria-current="page"
      className="max-w-[160px] truncate font-semibold text-foreground"
    >
      {crumb.name}
    </span>
  );
}

export function Breadcrumbs({
  folderId,
  onNavigate,
  variant = 'inline',
  rootLabel,
}: Props) {
  const t = useTranslations('folders');
  const isMobile = useIsMobile();
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);

  useEffect(() => {
    if (!folderId) {
      setBreadcrumbs([]);
      return;
    }
    setBreadcrumbs([]);
    let cancelled = false;
    getFolderBreadcrumbs(folderId)
      .then((data) => {
        if (!cancelled) {
          setBreadcrumbs(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBreadcrumbs([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  const { visible, hidden } = useBreadcrumbSegments(breadcrumbs, isMobile);

  /*
    Nothing to render at the root.

    A trail of one crumb is not a trail: it names the place the title above it
    already names, leads nowhere, and costs a row over the table — a row phase
    7 does not have. Inside a folder it does real work, because the rail shows
    where you are and not the way back out.

    Rendered while the crumbs are still loading, so a folder does not flash the
    table up a row and then push it back down.
  */
  if (!folderId) {
    return null;
  }

  const isTitle = variant === 'title';

  /*
    The heading has to exist from the first paint, and the crumbs arrive a
    round trip later. Until they do, the root *is* the current place, so it
    takes the `<h1>`; once the trail lands the last crumb takes it and the
    root goes back to being a link. Without this the page has no `<h1>` for
    as long as the fetch takes.
  */
  const rootIsHeading = isTitle && visible.length === 0;
  const rootText = isTitle
    ? (rootLabel ?? t('knowledge-base'))
    : t('knowledge-base');

  return (
    <nav
      aria-label={t('breadcrumb-nav')}
      className={
        isTitle
          ? 'flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground'
          : 'flex items-center gap-1 text-sm font-medium text-foreground min-w-0'
      }
    >
      {/* Home / root */}
      {rootIsHeading ? (
        <h1 className="flex min-w-0 items-center gap-1 truncate font-display text-xl font-semibold text-foreground">
          <HomeIcon className="size-5 shrink-0" />
          <span className="truncate">{rootText}</span>
        </h1>
      ) : (
        <button
          type="button"
          onClick={() => onNavigate(null)}
          className={
            isTitle
              ? 'flex shrink-0 items-center gap-1 hover:text-foreground transition-colors'
              : 'flex items-center gap-1 shrink-0 hover:text-foreground transition-colors'
          }
        >
          <HomeIcon className="size-4" />
          <span>{rootText}</span>
        </button>
      )}

      {/* Overflow dropdown for hidden segments */}
      {hidden.length > 0 && (
        <>
          <ChevronRightIcon className={`size-3.5 ${separatorClass}`} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('more-folders')}
                title={hidden.map((h) => h.name).join(' / ')}
                className="px-1 rounded hover:bg-muted text-muted-foreground transition-colors shrink-0"
              >
                ...
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {hidden.map((crumb) => (
                <DropdownMenuItem
                  key={crumb.id}
                  onClick={() => onNavigate(crumb.id)}
                >
                  {crumb.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Visible segments */}
      {visible.map((crumb, index) => (
        <span key={crumb.id} className="flex items-center gap-1 min-w-0">
          <ChevronRightIcon className={`size-3.5 ${separatorClass}`} />
          <Segment
            crumb={crumb}
            isLast={index === visible.length - 1}
            isTitle={isTitle}
            onNavigate={onNavigate}
          />
        </span>
      ))}
    </nav>
  );
}
