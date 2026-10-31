import type * as React from 'react';
import type { ReactNode } from 'react';

export type GameButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type GameButtonSize = 'sm' | 'md' | 'lg';

export interface GameButtonProps {
  children: ReactNode;
  /** Visual style. Default: 'primary'. */
  variant?: GameButtonVariant;
  /** Touch-target size. Default: 'md'. All sizes meet the 44px minimum. */
  size?: GameButtonSize;
  onClick?: () => void;
  disabled?: boolean;
  /** Full width. */
  block?: boolean;
}

const SIZE: Record<GameButtonSize, string> = {
  sm: 'min-h-11 px-4 py-2 text-[0.85rem] rounded-[0.625rem]',
  md: 'min-h-12 px-5 py-[0.625rem] text-[0.9rem] rounded-xl',
  lg: 'min-h-14 px-7 py-3 text-base rounded-[0.875rem]',
};

const VARIANT: Record<GameButtonVariant, string> = {
  primary: 'bg-accent text-white',
  secondary: 'bg-panel text-ink ring-1 ring-inset ring-line',
  ghost: 'bg-transparent text-muted',
  danger: 'bg-danger text-white',
};

/**
 * Prescribed game button. Touch-friendly (min 44px target), brand-consistent
 * styling. Four variants, three sizes — all opinionated, nothing custom.
 * Utilities on the platform tokens; the press feedback is `active:scale`.
 */
export function GameButton({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  disabled = false,
  block = false,
}: GameButtonProps): React.JSX.Element {
  const layout = block ? 'flex w-full' : 'inline-flex';
  const state = disabled
    ? 'cursor-default opacity-40'
    : 'cursor-pointer enabled:active:scale-[0.96]';

  return (
    <button
      className={`${layout} ${SIZE[size]} ${VARIANT[variant]} ${state} touch-manipulation items-center justify-center gap-2 border-0 font-bold leading-none transition-[transform,opacity] duration-[120ms] [-webkit-tap-highlight-color:transparent]`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
