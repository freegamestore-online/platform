import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY } from '../lib/theme';
import { ThemeSetting } from './ThemeSetting';
import { ThemeToggle } from './ThemeToggle';

function stubSystemDark(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matches && query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  stubSystemDark(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('ThemeToggle (#394)', () => {
  it('cycles system -> light -> dark and applies data-theme and the stored preference', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Theme: system' });

    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Theme: light' })).toBeInTheDocument();
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Theme: light' }));
    expect(screen.getByRole('button', { name: 'Theme: dark' })).toBeInTheDocument();
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Theme: dark' }));
    expect(screen.getByRole('button', { name: 'Theme: system' })).toBeInTheDocument();
    expect(localStorage.getItem(THEME_KEY)).toBe('system');
  });

  it('has a compact 28px size for the desktop header, so the header keeps its height', () => {
    render(<ThemeToggle compact />);
    const button = screen.getByRole('button', { name: /Theme:/ });
    expect(button.className).toContain('size-7');
    expect(button.className).not.toContain('size-11');
  });

  it('starts from the saved preference', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Theme: dark' })).toBeInTheDocument();
  });

  it('is a 44px touch target on the opaque panel surface, with no inline style', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: /Theme:/ });
    expect(button.className).toContain('size-11');
    expect(button.className).toContain('bg-panel');
    expect(button.getAttribute('style')).toBeNull();
  });
});

describe('ThemeSetting (#394)', () => {
  it('shows all three choices with the saved one pressed', () => {
    localStorage.setItem(THEME_KEY, 'light');
    render(<ThemeSetting />);
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies a choice live and persists it', () => {
    render(<ThemeSetting />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
