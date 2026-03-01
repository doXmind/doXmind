import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface GridPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function GridPagination({ page, totalPages, onPageChange }: GridPaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="mt-8 flex items-center justify-center gap-1">
      <button
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="rounded-md p-2 text-muted-foreground/40 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {Array.from({ length: totalPages }).map((_, i) => (
        <button
          key={i}
          onClick={() => onPageChange(i)}
          className={cn(
            "h-8 min-w-[32px] rounded-md px-1.5 text-xs transition-all",
            i === page
              ? "bg-foreground/[0.07] font-medium text-foreground"
              : "text-muted-foreground/40 hover:text-foreground"
          )}
        >
          {i + 1}
        </button>
      ))}

      <button
        onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        disabled={page === totalPages - 1}
        className="rounded-md p-2 text-muted-foreground/40 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-20"
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
