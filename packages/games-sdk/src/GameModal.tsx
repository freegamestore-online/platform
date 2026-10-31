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
 * Styled with Tailwind utilities on the platform tokens. The dialog sits on an
 * opaque surface (`bg-panel`); only the scrim behind it is translucent.
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
      className="fixed inset-0 z-[900] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80dvh] w-full max-w-[400px] overflow-auto rounded-2xl border border-line bg-panel"
      >
        {title && (
          <div className="flex items-center justify-between border-b border-line px-4 py-[0.85rem]">
            <span className="text-base font-bold text-ink">{title}</span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer border-0 bg-transparent p-1 text-xl leading-none text-muted"
            >
              &times;
            </button>
          </div>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
