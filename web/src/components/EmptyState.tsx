import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

// Friendly placeholder for empty screens: an icon, a title, a short message, and
// an optional call to action (an internal link or a button).
export default function EmptyState({
  icon: Icon,
  title,
  message,
  cta,
}: {
  icon: LucideIcon;
  title: string;
  message?: string;
  cta?: { label: string; to: string } | { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center animate-in">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Icon size={26} aria-hidden="true" />
      </span>
      <h2 className="text-lg font-semibold text-gray-700">{title}</h2>
      {message && <p className="max-w-xs text-sm text-gray-500">{message}</p>}
      {cta &&
        ('to' in cta ? (
          <Link to={cta.to} className="btn-primary mt-1">
            {cta.label}
          </Link>
        ) : (
          <button className="btn-primary mt-1" onClick={cta.onClick}>
            {cta.label}
          </button>
        ))}
    </div>
  );
}
