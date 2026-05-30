import { type ReactNode, useEffect } from 'react';

export interface GameModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Fullscreen modal overlay for games. Used for rules, settings, confirmations.
 * Closes on backdrop click or Escape key.
 * Styled with platform design tokens for consistency across all games.
 */
export function GameModal({ open, onClose, title, children }: GameModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--panel, #ffffff)',
          border: '1px solid var(--line, #e2e8f0)',
          borderRadius: '1rem',
          maxWidth: 400,
          width: '100%',
          maxHeight: '80dvh',
          overflow: 'auto',
        }}
      >
        {title && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.85rem 1rem',
              borderBottom: '1px solid var(--line, #e2e8f0)',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: '1rem',
                color: 'var(--ink, #1e293b)',
                fontFamily: '"Manrope", system-ui, sans-serif',
              }}
            >
              {title}
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.25rem',
                lineHeight: 1,
                color: 'var(--muted, #64748b)',
                padding: '0.25rem',
                fontFamily: 'inherit',
              }}
            >
              &times;
            </button>
          </div>
        )}
        <div style={{ padding: '1rem' }}>{children}</div>
      </div>
    </div>
  );
}
