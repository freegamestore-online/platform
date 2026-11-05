import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach } from 'vitest';
import { SoundProvider, useSound } from '../src/SoundContext.js';

afterEach(() => {
  cleanup();
  if (typeof document === 'undefined') return; // node-environment test files
  // The mute state is page-wide (module-level, #410): re-mute so a test that
  // unmuted does not leak into the next one.
  const { result, unmount } = renderHook(() => useSound(), { wrapper: SoundProvider });
  if (!result.current.muted) act(() => result.current.toggle());
  unmount();
});
