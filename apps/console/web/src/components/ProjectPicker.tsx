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
function statusDotColor(project: Project): string {
  switch (activityTone(project.activity, project.deployed)) {
    case 'success':
      return 'var(--success)'; // live / last build succeeded
    case 'accent':
      return 'var(--warning)'; // writing / provisioning / pushing / building — in progress
    case 'danger':
      return 'var(--error)'; // last build failed
    default:
      return 'var(--line-strong)'; // never built / unknown
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
      className="fixed inset-0 flex items-center justify-center"
      role="dialog"
      aria-label="Project picker"
      style={{
        background: 'var(--overlay-bg)',
        zIndex: 'var(--z-modal)',
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        role="document"
        className="rounded-2xl shadow-xl w-full max-w-md mx-4"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 shrink-0"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <h2 className="text-lg font-bold">Sessions</h2>
          <IconButton variant="ghost" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Tabs */}
        <div
          className="flex shrink-0"
          style={{ borderBottom: '1px solid var(--line)' }}
          role="tablist"
        >
          <button
            role="tab"
            aria-selected={tab === 'sessions'}
            aria-controls="sessions-panel"
            onClick={() => setTab('sessions')}
            className="flex-1 py-2 text-sm font-semibold"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: tab === 'sessions' ? 'var(--ink)' : 'var(--muted)',
              borderBottom:
                tab === 'sessions' ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            Open sessions
          </button>
          <button
            role="tab"
            aria-selected={tab === 'new'}
            aria-controls="new-panel"
            onClick={() => setTab('new')}
            className="flex-1 py-2 text-sm font-semibold"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: tab === 'new' ? 'var(--ink)' : 'var(--muted)',
              borderBottom: tab === 'new' ? '2px solid var(--accent)' : '2px solid transparent',
            }}
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
        <div className="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
          {tab === 'sessions' ? (
            <div id="sessions-panel" role="tabpanel">
              {loadError && (
                <div className="text-center py-6 text-sm" style={{ color: 'var(--muted)' }}>
                  <p style={{ color: '#ef4444' }}>Couldn't load your sessions.</p>
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
                  className="w-full flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg mb-1"
                  style={{
                    background:
                      p.id === currentId
                        ? 'color-mix(in srgb, var(--accent) 10%, var(--panel))'
                        : 'transparent',
                  }}
                >
                  <button
                    onClick={() => handleSelect(p)}
                    className="flex-1 flex items-center gap-3 min-w-0 py-1.5 text-left"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--ink)',
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: statusDotColor(p),
                        flexShrink: 0,
                      }}
                      title={activityLabel(p.activity, p.deployed)}
                      aria-label={`Status: ${activityLabel(p.activity, p.deployed)}`}
                      role="presentation"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{p.name}</div>
                      {p.appId && (
                        <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                          {p.appId}
                        </div>
                      )}
                    </div>
                    <span
                      className="text-xs shrink-0 font-medium"
                      style={{ color: statusDotColor(p) }}
                    >
                      {activityLabel(p.activity, p.deployed)}
                    </span>
                    {p.id === currentId && (
                      <span className="text-xs shrink-0" style={{ color: 'var(--accent)' }}>
                        current
                      </span>
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
                <div className="text-center py-6 text-sm" style={{ color: 'var(--muted)' }}>
                  {projects.length === 0 ? (
                    <>
                      No open sessions. Start one on the <strong>New</strong> tab, or open a game
                      from{' '}
                      <a href="/" className="hover:underline" style={{ color: 'var(--accent)' }}>
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
              <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
                Start a new game — you'll pick a name and a template (2D canvas, grid, cards, or
                3D). To keep editing an existing game, open it from{' '}
                <a href="/" className="hover:underline" style={{ color: 'var(--accent)' }}>
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
