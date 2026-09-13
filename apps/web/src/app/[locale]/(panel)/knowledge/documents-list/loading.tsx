import { DocumentsTableSkeleton } from '@/app/components/ManageKnowledge/UserFiles/FileList/DocumentsTableSkeleton';

/**
 * The shape the page settles into, so it does not jump when it arrives.
 *
 * Phase 7's layout is: a title row carrying New folder and Add document, then
 * one row holding search, the sort chip, the three filter chips and the view
 * toggle, then the table. There is no breadcrumb row at the root — a trail of
 * one crumb names the place the title already names — and the rail is 216px,
 * not 224.
 *
 * It carries `data-panel-fullwidth` and the same min-h-0 chain as the loaded
 * page. Without that the skeleton renders capped and short, and the page
 * visibly jumps sideways the moment the data arrives.
 */
export default function DocumentsListLoading() {
  return (
    <div data-panel-fullwidth className="flex min-h-0 flex-1 gap-3">
      {/* Rail skeleton: three scopes, then folders. */}
      <div className="hidden min-h-0 w-[216px] shrink-0 border-r border-border pr-2 lg:block">
        <div className="flex flex-col gap-2 pt-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-7 w-full animate-pulse rounded bg-paper-200 dark:bg-paper-700"
            />
          ))}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Title and its two actions. */}
        <div className="mb-3 flex shrink-0 items-start gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="h-6 w-32 animate-pulse rounded bg-paper-200 dark:bg-paper-700" />
            <div className="h-4 w-44 animate-pulse rounded bg-paper-200 dark:bg-paper-700" />
          </div>
          <div className="flex-1" />
          <div className="h-9 w-32 animate-pulse rounded-lg bg-paper-200 dark:bg-paper-700" />
          <div className="h-9 w-36 animate-pulse rounded-lg bg-paper-200 dark:bg-paper-700" />
        </div>

        {/* Search, the sort chip, the three filter chips, and the view toggle
            at the far end. */}
        <div className="mb-3 flex shrink-0 items-center gap-2">
          <div className="h-9 w-52 animate-pulse rounded-md bg-paper-200 dark:bg-paper-700" />
          <div className="h-8 w-32 animate-pulse rounded-md bg-paper-200 dark:bg-paper-700" />
          <div className="h-8 w-28 animate-pulse rounded-md bg-paper-200 dark:bg-paper-700" />
          <div className="h-8 w-32 animate-pulse rounded-md bg-paper-200 dark:bg-paper-700" />
          <div className="h-8 w-28 animate-pulse rounded-md bg-paper-200 dark:bg-paper-700" />
          <div className="flex-1" />
          <div className="hidden md:block h-9 w-[72px] animate-pulse rounded-md bg-paper-200 dark:bg-paper-700" />
        </div>

        <DocumentsTableSkeleton />
      </div>
    </div>
  );
}
