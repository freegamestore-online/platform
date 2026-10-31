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
      <p className="m-0 mb-5 text-[0.9rem] leading-normal text-muted">{message}</p>
      <div className="flex justify-end gap-2">
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
