import type { ButtonHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
export type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors cursor-pointer ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--accent)] text-black border border-transparent hover:opacity-90',
  secondary: 'bg-transparent text-[var(--ink)] border border-[var(--border)] hover:bg-[var(--bg)]',
  ghost:
    'bg-transparent text-[var(--muted)] border border-transparent hover:bg-[var(--bg)] hover:text-[var(--ink)]',
  danger: 'bg-[#ef4444] text-white border border-transparent hover:opacity-90',
  'danger-outline': 'bg-transparent text-[#ef4444] border border-[#ef4444] hover:bg-[#ef4444]/10',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2', // 44px — a real touch target
};

/** The button class string — for when you need a <Link>/<a> to look like a
 *  Button (react-router Link, external anchors). */
export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className, ...props }, ref) => (
    <button ref={ref} className={buttonClass(variant, size, className)} {...props} />
  ),
);

/** Square, icon-only button. Pass a single lucide icon as children. */
export function IconButton({ variant = 'ghost', size = 'md', className, ...props }: ButtonProps) {
  const square = size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  return <button className={cn(BASE, VARIANTS[variant], square, 'p-0', className)} {...props} />;
}
