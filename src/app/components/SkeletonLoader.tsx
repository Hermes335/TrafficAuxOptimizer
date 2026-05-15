import { cn } from "./ui/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn("animate-pulse rounded-md bg-gray-200", className)} />
  );
}

interface CardSkeletonProps {
  lines?: number;
}

export function CardSkeleton({ lines = 1 }: CardSkeletonProps) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-3/4" />
        ))}
      </div>
    </div>
  );
}

export function KPISkeleton() {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-3 rounded-full" />
      </div>
      <Skeleton className="h-8 w-16" />
    </div>
  );
}

export function ListSkeleton({ items = 5 }: { items?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b p-4">
          <Skeleton className="h-2 w-2 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-4 rounded" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left">
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="px-3 py-2">
                <Skeleton className="h-4 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex} className="border-b">
              {Array.from({ length: cols }).map((_, colIndex) => (
                <td key={colIndex} className="px-3 py-3">
                  <Skeleton className="h-4 w-full" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-xl border bg-white p-4">
      <Skeleton className="mb-4 h-5 w-40" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}