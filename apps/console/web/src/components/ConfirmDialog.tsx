import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from './ui';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDangerous = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the cancel button by default (safer default)
    setTimeout(() => confirmButtonRef.current?.focus(), 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="bg-panel border border-line rounded-dialog max-w-[400px] w-full p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 id="dialog-title" className="text-[1.125rem] font-bold text-ink m-0">
            {title}
          </h2>
          <button
            onClick={onCancel}
            aria-label="Close dialog"
            className="bg-transparent border-0 cursor-pointer p-1 text-muted shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-[0.95rem] text-ink m-0 mb-6 whitespace-pre-wrap">{message}</p>

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button
            ref={confirmButtonRef}
            variant={isDangerous ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
