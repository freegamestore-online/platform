import { RotateCcw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '../hooks/useProjects';
import { activityLabel, activityTone } from '../lib/sessions';
import { ConfirmDialog } from './ConfirmDialog';
import { Button, IconButton, Input } from './ui';

// Colored status dot for each session, driven by the last known build/deploy
// phase (session.activity, surfaced by mapServerSession). We can't reuse the
// Badge tones directly for the dot: Badge's "accent" is green, so an in-progress
// build would read as already-live. Map in-progress to amber so the four states
// are visually distinct — green = live, amber = building, red = failed, grey =
// never built / unknown.
// Complete class-name literals (Tailwind scans source text): `dot` paints the
// status dot, `text` the status label beside it.
function statusClasses(project: Project): { dot: string; text: string } {
  switch (activityTone(project.activity, project.deployed)) {
    case 'success':
      return { dot: 'bg-success', text: 'text-success' }; // live / last build succeeded
    case 'accent':
      return { dot: 'bg-warning', text: 'text-warning' }; // writing / provisioning / pushing / building — in progress
    case 'danger':
      return { dot: 'bg-danger', text: 'text-danger' }; // last build failed
    default:
      return { dot: 'bg-line-strong', text: 'text-line-strong' }; // never built / unknown
  }
}

interface ProjectPickerProps {
  projects: Project[];
  currentId: string | null;
  loadError?: boolean;
  onRetry?: () => void;
  onSelect: (id: string) => void;
  onCreate: (name: string, appId?: string) => void;
  /** Delete a chat session (keeps the game + its code; just removes this chat). */
  onDelete: (id: string) => void;
  /** Start a clean chat for a live game (keeps the game; resets its conversation). */
  onFreshChat: (appId: string) => void;
  onClose: () => void;
}

/**
 * Switch between your OPEN studio sessions, or start a new game. This is
 * intentionally NOT a game catalog — browsing/opening any of your games lives in
 * one place, "My Games" (the dashboard), which opens a game into a session via
 * import. The picker used to render a second full registry catalog here, which
 * duplicated that list and drifted from it.
 */
export function ProjectPicker({
  projects,
  currentId,
  loadError,
  onRetry,
  onSelect,
  onCreate,
  onDelete,
  onFreshChat,
  onClose,
}: ProjectPickerProps) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'sessions' | 'new'>('sessions');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; project: Project | null }>({
    open: false,
    project: null,
  });
  const [freshDialog, setFreshDialog] = useState<{ open: boolean; project: Project | null }>({
    open: false,
    project: null,
  });

  const q = search.toLowerCase();
  const filtered = projects.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || (p.appId ?? '').toLowerCase().includes(q),
  );

  function handleSelect(project: Project) {
    onSelect(project.id);
    onClose();
  }

  function handleCreateNew() {
    onCreate('');
    onClose();
  }

  function handleDelete(project: Project) {
    setDeleteDialog({ open: true, project });
  }

  function handleFresh(project: Project) {
    if (!project.appId) return;
    setFreshDialog({ open: true, project });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim"
      role="dialog"
      aria-label="Project picker"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        role="document"
        className="rounded-2xl shadow-xl w-full max-w-md mx-4 bg-panel border border-line max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 shrink-0 border-b border-line">
          <h2 className="text-lg font-bold">Sessions</h2>
          <IconButton variant="ghost" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-line" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'sessions'}
            aria-controls="sessions-panel"
            onClick={() => setTab('sessions')}
            className={`flex-1 py-2 text-sm font-semibold bg-transparent border-0 cursor-pointer border-b-2 ${
              tab === 'sessions' ? 'text-ink border-accent' : 'text-muted border-transparent'
            }`}
          >
            Open sessions
          </button>
          <button
            role="tab"
            aria-selected={tab === 'new'}
            aria-controls="new-panel"
            onClick={() => setTab('new')}
            className={`flex-1 py-2 text-sm font-semibold bg-transparent border-0 cursor-pointer border-b-2 ${
              tab === 'new' ? 'text-ink border-accent' : 'text-muted border-transparent'
            }`}
          >
            New
          </button>
        </div>

        {/* Search (sessions tab) */}
        {tab === 'sessions' && projects.length > 0 && (
          <div className="px-3 pt-3 shrink-0">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sessions..."
              aria-label="Search sessions"
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {tab === 'sessions' ? (
            <div id="sessions-panel" role="tabpanel">
              {loadError && (
                <div className="text-center py-6 text-sm text-muted">
                  <p className="text-danger">Couldn't load your sessions.</p>
                  <p className="mt-1">You may need to sign in again.</p>
                  {onRetry && (
                    <Button variant="primary" size="sm" onClick={onRetry} className="mt-2">
                      Retry
                    </Button>
                  )}
                </div>
              )}

              {filtered.map((p) => (
                <div
                  key={p.id}
                  className={`w-full flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg mb-1 ${
                    p.id === currentId ? 'bg-accent/10' : 'bg-transparent'
                  }`}
                >
                  <button
                    onClick={() => handleSelect(p)}
                    className="flex-1 flex items-center gap-3 min-w-0 py-1.5 text-left bg-transparent border-0 cursor-pointer text-ink"
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${statusClasses(p).dot}`}
                      title={activityLabel(p.activity, p.deployed)}
                      aria-label={`Status: ${activityLabel(p.activity, p.deployed)}`}
                      role="presentation"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{p.name}</div>
                      {p.appId && <div className="text-xs truncate text-muted">{p.appId}</div>}
                    </div>
                    <span className={`text-xs shrink-0 font-medium ${statusClasses(p).text}`}>
                      {activityLabel(p.activity, p.deployed)}
                    </span>
                    {p.id === currentId && (
                      <span className="text-xs shrink-0 text-accent">current</span>
                    )}
                  </button>
                  {/* Fresh chat — only for a live game (needs a repo to re-import). */}
                  {p.deployed && p.appId && (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={`Start a fresh chat for ${p.name || p.appId}`}
                      title="Start a fresh chat (keeps the game, clears this conversation)"
                      onClick={() => handleFresh(p)}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </IconButton>
                  )}
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete chat ${p.name || ''}`}
                    title="Delete this chat session (the game is not affected)"
                    onClick={() => handleDelete(p)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </IconButton>
                </div>
              ))}

              {!loadError && filtered.length === 0 && (
                <div className="text-center py-6 text-sm text-muted">
                  {projects.length === 0 ? (
                    <>
                      No open sessions. Start one on the <strong>New</strong> tab, or open a game
                      from{' '}
                      <a href="/" className="hover:underline text-accent">
                        My Games
                      </a>
                      .
                    </>
                  ) : (
                    'No sessions match your search.'
                  )}
                </div>
              )}
            </div>
          ) : (
            <div id="new-panel" role="tabpanel" className="py-4">
              <p className="text-sm mb-3 text-muted">
                Start a new game — you'll pick a name and a template (2D canvas, grid, cards, or
                3D). To keep editing an existing game, open it from{' '}
                <a href="/" className="hover:underline text-accent">
                  My Games
                </a>
                .
              </p>
              <Button variant="primary" onClick={handleCreateNew} className="w-full">
                New Game
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Delete dialog */}
      <ConfirmDialog
        open={deleteDialog.open}
        title="Delete chat session?"
        message={`Delete this chat session${deleteDialog.project?.name ? ` "${deleteDialog.project.name}"` : ''}?\n\nThis removes only the conversation. The game and its code are not affected.`}
        confirmText="Delete"
        cancelText="Keep it"
        isDangerous
        onConfirm={() => {
          if (deleteDialog.project) {
            onDelete(deleteDialog.project.id);
          }
          setDeleteDialog({ open: false, project: null });
        }}
        onCancel={() => setDeleteDialog({ open: false, project: null })}
      />

      {/* Fresh chat dialog */}
      <ConfirmDialog
        open={freshDialog.open}
        title="Start a fresh chat?"
        message={`Start a fresh chat for "${freshDialog.project?.name || freshDialog.project?.appId}"?\n\nThe game and its code stay live — this only clears the current conversation and reloads the game's files into a clean chat.`}
        confirmText="Start fresh"
        cancelText="Cancel"
        onConfirm={() => {
          if (freshDialog.project?.appId) {
            onFreshChat(freshDialog.project.appId);
            onClose();
          }
          setFreshDialog({ open: false, project: null });
        }}
        onCancel={() => setFreshDialog({ open: false, project: null })}
      />
    </div>
  );
}
