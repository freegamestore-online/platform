import { useState } from "react";
import { X } from "lucide-react";
import type { Project } from "../hooks/useProjects";
import { Button, IconButton, Input } from "./ui";

interface ProjectPickerProps {
  projects: Project[];
  currentId: string | null;
  loadError?: boolean;
  onRetry?: () => void;
  onSelect: (id: string) => void;
  onCreate: (name: string, appId?: string) => void;
  onClose: () => void;
}

/**
 * Switch between your OPEN studio sessions, or start a new game. This is
 * intentionally NOT a game catalog — browsing/opening any of your games lives in
 * one place, "My Games" (the dashboard), which opens a game into a session via
 * import. The picker used to render a second full registry catalog here, which
 * duplicated that list and drifted from it.
 */
export function ProjectPicker({ projects, currentId, loadError, onRetry, onSelect, onCreate, onClose }: ProjectPickerProps) {
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"sessions" | "new">("sessions");

  const q = search.toLowerCase();
  const filtered = projects.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.appId ?? "").toLowerCase().includes(q));

  function handleSelect(project: Project) {
    onSelect(project.id);
    onClose();
  }

  function handleCreateNew() {
    if (!newName.trim()) return;
    onCreate(newName.trim());
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label="Project picker" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div role="document" className="rounded-2xl shadow-xl w-full max-w-md mx-4" style={{ background: "var(--panel)", border: "1px solid var(--line)", maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-4 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
          <h2 className="text-lg font-bold">Sessions</h2>
          <IconButton variant="ghost" onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></IconButton>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
          <button onClick={() => setTab("sessions")} className="flex-1 py-2 text-sm font-semibold" style={{ background: "none", border: "none", cursor: "pointer", color: tab === "sessions" ? "var(--ink)" : "var(--muted)", borderBottom: tab === "sessions" ? "2px solid var(--accent)" : "2px solid transparent" }}>
            Open sessions
          </button>
          <button onClick={() => setTab("new")} className="flex-1 py-2 text-sm font-semibold" style={{ background: "none", border: "none", cursor: "pointer", color: tab === "new" ? "var(--ink)" : "var(--muted)", borderBottom: tab === "new" ? "2px solid var(--accent)" : "2px solid transparent" }}>
            New
          </button>
        </div>

        {/* Search (sessions tab) */}
        {tab === "sessions" && projects.length > 0 && (
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
          {tab === "sessions" ? (
            <>
              {loadError && (
                <div className="text-center py-6 text-sm" style={{ color: "var(--muted)" }}>
                  <p style={{ color: "#ef4444" }}>Couldn't load your sessions.</p>
                  <p className="mt-1">You may need to sign in again.</p>
                  {onRetry && (
                    <Button variant="primary" size="sm" onClick={onRetry} className="mt-2">
                      Retry
                    </Button>
                  )}
                </div>
              )}

              {filtered.map((p) => (
                <button key={p.id} onClick={() => handleSelect(p)} className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left mb-1" style={{ background: p.id === currentId ? "color-mix(in srgb, var(--accent) 10%, var(--panel))" : "transparent", border: "none", cursor: "pointer", color: "var(--ink)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.deployed ? "#16a34a" : "var(--line-strong)", flexShrink: 0 }} title={p.deployed ? "Live" : "Draft"} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{p.name}</div>
                    {p.appId && <div className="text-xs truncate" style={{ color: "var(--muted)" }}>{p.appId}</div>}
                  </div>
                  {p.id === currentId && <span className="text-xs" style={{ color: "var(--accent)" }}>current</span>}
                </button>
              ))}

              {!loadError && filtered.length === 0 && (
                <div className="text-center py-6 text-sm" style={{ color: "var(--muted)" }}>
                  {projects.length === 0
                    ? <>No open sessions. Start one on the <strong>New</strong> tab, or open a game from <a href="/" className="hover:underline" style={{ color: "var(--accent)" }}>My Games</a>.</>
                    : "No sessions match your search."}
                </div>
              )}
            </>
          ) : (
            /* New session */
            <div className="py-4">
              <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>Start a new game from scratch. To keep editing an existing game, open it from <a href="/" className="hover:underline" style={{ color: "var(--accent)" }}>My Games</a>.</p>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Game name..."
                aria-label="New game name"
                className="mb-3"
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateNew(); }}
              />
              <Button variant="primary" onClick={handleCreateNew} disabled={!newName.trim()} className="w-full">
                Create Game
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
