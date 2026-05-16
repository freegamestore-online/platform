import type * as React from 'react';
import type { ReactNode } from 'react';
import { SoundProvider } from './SoundContext.js';

export interface GameShellProps {
  /**
   * Optional top bar — typically `<GameTopbar score={…} />`. Renders
   * above the play area in a fixed-height row.
   */
  topbar?: ReactNode;
  /** The game itself. Sized to fill the remaining viewport. */
  children: ReactNode;
}

/**
 * Brand-consistent layout for a game.
 *
 * Hard guarantees:
 *   - Outer wrapper is exactly 100svh tall, full-width — no body scroll.
 *   - The play area fills whatever's left after the topbar — never larger.
 *   - `overflow: hidden` on the wrapper means a game's internal overflow
 *     can't bleed out and create document-level scroll.
 *
 * Why 100svh (small viewport units) and not 100vh: on iOS Safari, 100vh
 * includes the URL bar's hidden area, which lets content overflow when
 * the bar reveals. 100svh stays equal to the *visible* viewport.
 */
export function GameShell({ topbar, children }: GameShellProps): React.JSX.Element {
  return (
    <SoundProvider>
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--paper)',
        color: 'var(--ink)',
        overflow: 'hidden',
        // 100svh handles iOS URL-bar height changes correctly.
        height: '100svh',
        width: '100vw',
        // Games are touch-first — prevent text selection, long-press menus,
        // and the 300ms tap delay that makes games feel sluggish.
        WebkitUserSelect: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'manipulation',
      }}
    >
      {topbar !== undefined && (
        <div
          style={{
            flexShrink: 0,
            borderBottom: '1px solid var(--line, #e5e5e5)',
            background: 'var(--panel, var(--paper))',
          }}
        >
          {topbar}
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
      {/* Safe area bar — padding for iPhone home indicator swipe zone.
          Shows the platform URL so the space isn't wasted. On devices
          without a home indicator (env() resolves to 0) the bar is
          invisible. */}
      <div
        style={{
          flexShrink: 0,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          background: 'var(--panel, var(--paper))',
          borderTop: '1px solid var(--line, #e5e5e5)',
          textAlign: 'center',
        }}
      >
        <a
          href="https://freegamestore.online"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            padding: '0.15rem 0',
            fontSize: '0.55rem',
            fontFamily: '"Manrope", system-ui, sans-serif',
            fontWeight: 600,
            color: 'var(--muted, #999)',
            textDecoration: 'none',
            letterSpacing: '0.03em',
          }}
        >
          freegamestore.online
        </a>
      </div>
    </div>
    </SoundProvider>
  );
}
