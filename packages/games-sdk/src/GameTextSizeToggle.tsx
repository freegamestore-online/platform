import { useCallback, useEffect, useState } from 'react';

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

  // Keep the DOM in sync with the size — on mount (so a saved size is applied on
  // reload, not just when cycled) and on every change.
  useEffect(() => {
    apply(size);
  }, [size]);

  const cycle = useCallback(() => {
    const order: Size[] = ['default', 'lg', 'sm'];
    const next = order[(order.indexOf(size) + 1) % order.length]!;
    setSize(next); // the effect applies it
  }, [size]);

  const label = size === 'lg' ? 'A+' : size === 'sm' ? 'A\u2212' : 'A';

  return (
    <button
      onClick={cycle}
      aria-label={`Text: ${size}`}
      title={`Text: ${size}`}
      className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border border-line bg-panel p-0 text-ink text-[0.7rem] font-bold"
    >
      {label}
    </button>
  );
}
