import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-line bg-panel p-5', className)} {...props} />
  );
}

export type BadgeTone = 'accent' | 'success' | 'danger' | 'muted';

const TONES: Record<BadgeTone, string> = {
  accent: 'text-accent bg-accent-soft',
  success: 'text-success bg-success/12',
  danger: 'text-danger bg-danger/12',
  muted: 'text-muted bg-paper',
};

export function Badge({
  tone = 'accent',
  className,
  children,
  ...props
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
