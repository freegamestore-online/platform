import { GameButton } from './GameButton.js';
import { GameModal } from './GameModal.js';

export interface GameConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'default' | 'danger';
}

/**
 * Confirm/cancel dialog for games. Built on GameModal.
 * Use for: quit game, restart, delete save, etc.
 */
export function GameConfirm({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
}: GameConfirmProps) {
  return (
    <GameModal open={open} onClose={onCancel} title={title}>
      <p
        style={{
          fontSize: '0.9rem',
          color: 'var(--muted, #64748b)',
          margin: '0 0 1.25rem',
          lineHeight: 1.5,
          fontFamily: '"Manrope", system-ui, sans-serif',
        }}
      >
        {message}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <GameButton onClick={onCancel} variant="secondary" size="md">
          {cancelLabel}
        </GameButton>
        <GameButton
          onClick={onConfirm}
          variant={variant === 'danger' ? 'danger' : 'primary'}
          size="md"
        >
          {confirmLabel}
        </GameButton>
      </div>
    </GameModal>
  );
}
