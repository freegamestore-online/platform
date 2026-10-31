import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  getThemePref,
  nextThemePref,
  resolveTheme,
  THEME_KEY,
  THEME_PREFS,
  watchSystemTheme,
} from './theme';

// platform#394 (DESIGN-SYSTEM.md §3-4): one mechanism, `data-theme="dark"` on <html>;
// the preference lives under the shared `stores-theme` key.

function stubSystemDark(matches: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matches && query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  );
  return listeners;
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    stubSystemDark(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the shared stores-theme key', () => {
    expect(THEME_KEY).toBe('stores-theme');
  });

  it('defaults to system with nothing, or an invalid value, stored', () => {
    expect(getThemePref()).toBe('system');
    localStorage.setItem(THEME_KEY, 'purple');
    expect(getThemePref()).toBe('system');
  });

  it('round-trips each preference through localStorage', () => {
    for (const { value } of THEME_PREFS) {
      applyTheme(value);
      expect(getThemePref()).toBe(value);
    }
  });

  it('sets data-theme="dark" for dark and removes it for light', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('never uses a .dark class', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolves system from the OS preference', () => {
    expect(resolveTheme('system')).toBe('light');
    stubSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('cycles system -> light -> dark -> system', () => {
    expect(nextThemePref('system')).toBe('light');
    expect(nextThemePref('light')).toBe('dark');
    expect(nextThemePref('dark')).toBe('system');
  });

  it('keeps working when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(getThemePref()).toBe('system');
    expect(() => applyTheme('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
    vi.restoreAllMocks();
  });

  it('watchSystemTheme subscribes and unsubscribes', () => {
    const listeners = stubSystemDark(false);
    const onChange = vi.fn();
    const stop = watchSystemTheme(onChange);
    expect(listeners.size).toBe(1);
    for (const fn of listeners) fn();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});
