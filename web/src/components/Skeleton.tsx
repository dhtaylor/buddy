import { Loader2 } from 'lucide-react';

// A pulsing placeholder block used while content loads. Pass Tailwind sizing via
// className (e.g. "h-6 w-24").
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-gray-200 ${className}`} aria-hidden="true" />;
}

// A card-shaped skeleton standing in for a list row / card while loading.
export function SkeletonCard() {
  return (
    <div className="card flex flex-col gap-2" aria-hidden="true">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

// Inline spinner for compact loading states. role="status" for screen readers.
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-4 text-gray-400" role="status">
      <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
