import { useNavigate } from 'react-router-dom';
import { CreateGameForm } from './CreateGameForm';

/** The ONE "new game" surface. Pick a name + template, provision the game from
 *  that template, then open it in Studio (which imports its real repo). Used by
 *  both the Dashboard and the studio so there's a single create flow — not a
 *  template-picker form in one place and a blank canvas-only session in another. */
export function NewGameModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 cursor-default"
        style={{ background: 'transparent', border: 'none' }}
      />
      <div className="relative w-full max-w-lg my-6">
        <CreateGameForm
          // On success, open the new game at its own URL — the /create/:id
          // route imports its real (canvas / 3D / …) repo, so Studio edits
          // the actual template rather than a fresh canvas scaffold.
          onCreated={(id) => {
            onClose();
            navigate(`/create/${id}`);
          }}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
