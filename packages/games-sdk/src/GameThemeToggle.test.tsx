import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameThemeToggle } from './GameThemeToggle.js';

// #99: the toggle read localStorage in a render-time initializer with no guard,
// so blocked storage (privacy mode, sandboxed iframe) threw a SecurityError and
// crashed the whole game. "system" also never followed OS theme changes.

const realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')!;

function blockStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

/** A controllable prefers-color-scheme media query. */
function mockOsTheme(initialDark: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: initialDark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  window.matchMedia = vi.fn(() => mq) as unknown as typeof window.matchMedia;
  return {
    setDark(dark: boolean) {
      mq.matches = dark;
      for (const fn of listeners) fn();
    },
  };
}

beforeEach(() => {
  mockOsTheme(false);
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  Object.defineProperty(window, 'localStorage', realStorage);
  window.localStorage.clear();
});

describe('GameThemeToggle with blocked storage (#99)', () => {
  it('renders instead of crashing when localStorage throws', () => {
    blockStorage();
    expect(() => render(<GameThemeToggle />)).not.toThrow();
    expect(screen.getByRole('button', { name: 'Theme: system' })).toBeInTheDocument();
  });

  it('still cycles and applies the theme when saving it fails', () => {
    blockStorage();
    render(<GameThemeToggle />);
    const button = screen.getByRole('button');
    fireEvent.click(button); // system → light
    fireEvent.click(button); // light → dark
    expect(button).toHaveAccessibleName('Theme: dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('still restores a saved preference when storage works', () => {
    window.localStorage.setItem('stores-theme', 'dark');
    render(<GameThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Theme: dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('GameThemeToggle system preference', () => {
  it('follows an OS theme change while set to system', () => {
    const os = mockOsTheme(false);
    render(<GameThemeToggle />);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    act(() => os.setDark(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => os.setDark(false));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('works where matchMedia is unavailable', () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    expect(() => render(<GameThemeToggle />)).not.toThrow();
  });
});
