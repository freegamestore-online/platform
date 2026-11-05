import type * as React from 'react';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

interface SoundState {
  muted: boolean;
  toggle: () => void;
}

// The mute state lives in one module-level store, not in the provider, so every
// useSound() on the page sees the same value: a hook called above <GameShell>
// used to get a context default that stayed muted forever while the topbar
// toggled the provider's own copy (#410). Muted until the user opts in.
let muted = true;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getMuted(): boolean {
  return muted;
}

function toggle(): void {
  muted = !muted;
  for (const listener of listeners) listener();
}

// Only marks that a <SoundProvider> (i.e. <GameShell>) is above the caller.
const InsideProvider = createContext(false);

export function SoundProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <InsideProvider.Provider value={true}>{children}</InsideProvider.Provider>;
}

// `env` is set by Vite (dev server and build); other bundlers leave it unset.
const isDev = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
let warnedOutsideProvider = false;

/**
 * Read the platform sound state. Muted by default.
 * Games MUST check `muted` before playing any audio.
 *
 * Call it (or `useGameSounds()`) inside `<GameShell>`. Outside it the hook
 * still follows the topbar toggle, but warns once in development.
 */
export function useSound(): SoundState {
  const inside = useContext(InsideProvider);
  const value = useSyncExternalStore(subscribe, getMuted, getMuted);
  useEffect(() => {
    if (inside || !isDev || warnedOutsideProvider) return;
    warnedOutsideProvider = true;
    console.warn(
      '[@freegamestore/games] useSound()/useGameSounds() was called outside <GameShell>. ' +
        'It still follows the topbar mute toggle, but call it inside <GameShell>.',
    );
  }, [inside]);
  return { muted: value, toggle };
}
