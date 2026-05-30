import { useCallback, useState } from 'react';

const KEY = 'stores-text-size';
type Size = 'default' | 'lg' | 'sm';

function getSize(): Size {
  if (typeof window === 'undefined') return 'default';
  const s = window.localStorage.getItem(KEY);
  if (s === 'lg' || s === 'sm') return s;
  return 'default';
}

function apply(size: Size) {
  if (typeof document === 'undefined') return;
  if (size === 'default') {
    delete document.documentElement.dataset.text;
  } else {
    document.documentElement.dataset.text = size;
  }
  window.localStorage.setItem(KEY, size);
}

/**
 * Compact text-size toggle for game topbars. 28px square, shows A/A+/A-.
 * Designed to fit in GameTopbar's `actions` slot alongside GameThemeToggle.
 */
export function GameTextSizeToggle() {
  const [size, setSize] = useState<Size>(getSize);

  const cycle = useCallback(() => {
    const order: Size[] = ['default', 'lg', 'sm'];
    const next = order[(order.indexOf(size) + 1) % order.length]!;
    setSize(next);
    apply(next);
  }, [size]);

  const label = size === 'lg' ? 'A+' : size === 'sm' ? 'A\u2212' : 'A';

  return (
    <button
      onClick={cycle}
      aria-label={`Text: ${size}`}
      title={`Text: ${size}`}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        border: '1px solid var(--line, #e2e8f0)',
        background: 'var(--panel, #ffffff)',
        color: 'var(--ink, #1e293b)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        fontFamily: '"Manrope", system-ui, sans-serif',
        fontSize: '0.7rem',
        fontWeight: 700,
      }}
    >
      {label}
    </button>
  );
}
