import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationFooterProps {
  /** 0-based current page index. */
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (index: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

/** Controlled pagination footer for plain client-side lists (no TanStack table). */
export function PaginationFooter({
  pageIndex,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}: PaginationFooterProps) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>Rows per page</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="Rows per page"
          className="rounded-md border border-border bg-background px-1.5 py-1 text-xs"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          Page {pageIndex + 1} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(pageIndex - 1)}
          disabled={pageIndex <= 0}
          aria-label="Previous page"
          data-testid="page-prev"
          className="rounded-md border border-border p-1 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(pageIndex + 1)}
          disabled={pageIndex >= pageCount - 1}
          aria-label="Next page"
          data-testid="page-next"
          className="rounded-md border border-border p-1 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
