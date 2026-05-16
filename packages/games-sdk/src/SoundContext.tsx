import { createContext, useState, useContext, useCallback } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';

interface SoundState {
  muted: boolean;
  toggle: () => void;
}

const SoundContext = createContext<SoundState>({ muted: true, toggle: () => {} });

export function SoundProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [muted, setMuted] = useState(true);
  const toggle = useCallback(() => setMuted((m) => !m), []);
  return (
    <SoundContext.Provider value={{ muted, toggle }}>
      {children}
    </SoundContext.Provider>
  );
}

/**
 * Read the platform sound state. Muted by default.
 * Games MUST check `muted` before playing any audio.
 */
export function useSound(): SoundState {
  return useContext(SoundContext);
}
