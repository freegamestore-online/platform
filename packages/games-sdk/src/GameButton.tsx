import type * as React from 'react';
import type { ReactNode } from 'react';

export type GameButtonVariant = 'primary' | 'secondary' | 'ghost';
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

const SIZE: Record<GameButtonSize, { minHeight: string; padding: string; fontSize: string; borderRadius: string }> = {
  sm: { minHeight: '2.75rem', padding: '0.5rem 1rem', fontSize: '0.85rem', borderRadius: '0.625rem' },
  md: { minHeight: '3rem', padding: '0.625rem 1.25rem', fontSize: '0.9rem', borderRadius: '0.75rem' },
  lg: { minHeight: '3.5rem', padding: '0.75rem 1.75rem', fontSize: '1rem', borderRadius: '0.875rem' },
};

/**
 * Prescribed game button. Touch-friendly (min 44px target), brand-consistent
 * styling. Three variants, three sizes — all opinionated, nothing custom.
 */
export function GameButton({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  disabled = false,
  block = false,
}: GameButtonProps): React.JSX.Element {
  const s = SIZE[size];

  const base: React.CSSProperties = {
    display: block ? 'flex' : 'inline-flex',
    width: block ? '100%' : undefined,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    minHeight: s.minHeight,
    padding: s.padding,
    fontSize: s.fontSize,
    fontFamily: '"Manrope", system-ui, sans-serif',
    fontWeight: 700,
    lineHeight: 1,
    borderRadius: s.borderRadius,
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'transform 120ms ease, opacity 120ms ease',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  };

  const variantStyles: Record<GameButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'var(--accent, #10b981)',
      color: '#fff',
    },
    secondary: {
      background: 'var(--panel, #f5f3f0)',
      color: 'var(--ink, #1a1a1a)',
      boxShadow: 'inset 0 0 0 1px var(--line, #e5e5e5)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--muted, #6b7280)',
    },
  };

  return (
    <button
      style={{ ...base, ...variantStyles[variant] }}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      onPointerDown={(e) => {
        if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.96)';
      }}
      onPointerUp={(e) => {
        (e.currentTarget as HTMLElement).style.transform = '';
      }}
      onPointerLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = '';
      }}
    >
      {children}
    </button>
  );
}
