/**
 * GameTopbar styles, as a string the component renders in a <style> tag.
 *
 * They were a CSS module imported by GameTopbar.tsx (0.18.0 to 0.20.0). The published dist kept
 * that bare `import './GameTopbar.module.css'`, which Node cannot load, so vitest suites in
 * games that render SDK components failed (#512). Utilities are not an option here: most games
 * do not `@source` the SDK's dist, so the bar would lose its styling. The rules are unchanged;
 * the class names are fixed and prefixed `fgs-tb-` instead of hashed. Colours and the motion
 * timing read the design tokens (TOKENS.md), each with a fallback, so the bar still renders when
 * a game does not load GAME_TOKENS_CSS.
 */

export const TOPBAR_CSS = `
.fgs-tb-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.25rem 0.75rem;
  height: 2rem;
}

.fgs-tb-group {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
}

.fgs-tb-groupEnd {
  gap: 0.75rem;
}

.fgs-tb-actions {
  display: flex;
  flex-shrink: 0;
  gap: 0.4rem;
  align-items: center;
}

/* The title side takes whatever room the right side leaves, but never less
   than its buttons plus the title's minimum width, so the right side cannot
   slide over it. */
.fgs-tb-groupStart {
  flex: 1 1 auto;
  min-width: auto;
}

/* The stats are the only part of the right side that may give way, so a narrow
   screen never pushes a control (Sign in, sound) off the bar (#414). Each stat
   is one 2rem row: a stat that does not fit wraps onto the hidden next row
   whole, instead of being cut through its digits. */
.fgs-tb-stats {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: flex-end;
  column-gap: 0.75rem;
  height: 2rem;
  min-width: 0;
  overflow: hidden;
}

.fgs-tb-title {
  font-family: var(--font-body, "Manrope", system-ui, sans-serif);
  font-weight: 600;
  font-size: 0.8rem;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Truncate, never vanish: a few letters stay visible on a 320px screen (#414).
     inline-size containment drops the text's own width from the layout, so the
     title fills the room that is left (flex-grow) instead of claiming its full
     length, and the stats keep priority over the end of a long title. */
  flex: 1 1 auto;
  min-width: 2.5rem;
  contain: inline-size;
}

/* Icon buttons and the catalog link. Every control in the topbar uses this. */
.fgs-tb-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--muted, #999);
  -webkit-tap-highlight-color: transparent;
  transition: opacity var(--motion-duration, 80ms) var(--motion-easing, ease-out);
}

.fgs-tb-link {
  text-decoration: none;
}

/* Tones: the play/pause icon is ink, the sound icon is accent when sound is on */
.fgs-tb-toneMuted {
  color: var(--muted, #999);
}

.fgs-tb-toneInk {
  color: var(--ink, #f0f0f0);
}

.fgs-tb-toneAccent {
  color: var(--accent, #10b981);
}

/* A tap dips the control slightly, so it feels anchored on touch screens */
.fgs-tb-button:active {
  opacity: 0.55;
}

.fgs-tb-button:focus-visible {
  outline: 2px solid var(--accent, #10b981);
  outline-offset: -2px;
  border-radius: 0.4rem;
}

/* Score and stat values */
.fgs-tb-stat {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex-shrink: 0;
  height: 2rem;
  text-align: right;
  line-height: 1.05;
  white-space: nowrap;
}

.fgs-tb-statValue {
  font-family: var(--font-body, "Manrope", system-ui, sans-serif);
  font-weight: 800;
  font-size: 0.85rem;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.fgs-tb-statAccent {
  color: var(--accent);
}

/* Label under a stat. 0.65rem keeps it legible in sunlight and for low vision. */
.fgs-tb-statLabel {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  line-height: 1;
}

/* Rules and About overlays: a full-screen panel with a header and a scrolling body */
.fgs-tb-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--paper, #0f0f0f);
  color: var(--ink, #f0f0f0);
}

.fgs-tb-overlayHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--line, #2a2a2a);
}

.fgs-tb-overlayTitle {
  font-family: var(--font-body, "Manrope", system-ui, sans-serif);
  font-weight: 700;
  font-size: 0.9rem;
}

.fgs-tb-overlayBody {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  font-family: var(--font-body, "Manrope", system-ui, sans-serif);
  font-size: 0.9rem;
  line-height: 1.6;
}

/* About panel */
.fgs-tb-aboutHeading {
  margin: 0 0 0.75rem;
  font-family: var(--font-display, "Fraunces", Georgia, serif);
  font-weight: 700;
  font-size: 1.5rem;
}

.fgs-tb-aboutExtra {
  margin-bottom: 1rem;
}

.fgs-tb-aboutGrid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 1rem;
  margin: 0;
  font-size: 0.85rem;
}

.fgs-tb-aboutGrid dt {
  color: var(--muted, #999);
}

.fgs-tb-aboutGrid dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.fgs-tb-code {
  font-family: monospace;
}

.fgs-tb-aboutNote {
  margin-top: 1.25rem;
  font-size: 0.8rem;
  color: var(--muted, #999);
}

.fgs-tb-aboutLink {
  color: var(--accent, #10b981);
  text-decoration: none;
}

/* Phones (≤480px): tighter spacing, narrower icon buttons (still 44px tall),
   and stats show only their value. The label stays for screen readers. */
@media (max-width: 480px) {
  .fgs-tb-bar {
    gap: 0.25rem;
    padding: 0.25rem;
  }

  .fgs-tb-groupEnd {
    gap: 0;
  }

  .fgs-tb-stats {
    column-gap: 0.5rem;
    margin-right: 0.25rem;
  }

  .fgs-tb-button {
    min-width: 1.75rem;
  }

  .fgs-tb-statLabel {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fgs-tb-button {
    transition: none;
  }
}
`;

/** Class names used by GameTopbar. Each key maps to the `fgs-tb-` class in TOPBAR_CSS. */
export const styles: Record<string, string> = Object.fromEntries(
  [
    'aboutExtra',
    'aboutGrid',
    'aboutHeading',
    'aboutLink',
    'aboutNote',
    'actions',
    'bar',
    'button',
    'code',
    'group',
    'groupEnd',
    'groupStart',
    'link',
    'overlay',
    'overlayBody',
    'overlayHeader',
    'overlayTitle',
    'stat',
    'statAccent',
    'statLabel',
    'statValue',
    'stats',
    'title',
    'toneAccent',
    'toneInk',
    'toneMuted',
  ].map((name) => [name, `fgs-tb-${name}`]),
);
