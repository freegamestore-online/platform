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
 *
 * Styled with Tailwind utilities on the platform tokens (ADR-001): the game
 * compiles them through `@source` on this package's `dist`.
 */
export function GameShell({ topbar, children }: GameShellProps): React.JSX.Element {
  return (
    <SoundProvider>
      {/* Games are touch-first: no text selection, long-press menu or 300ms tap delay. */}
      <div className="fixed inset-0 flex h-svh w-screen touch-manipulation select-none flex-col overflow-hidden bg-paper text-ink [-webkit-touch-callout:none]">
        {topbar !== undefined && (
          <div className="shrink-0 border-b border-line bg-panel">{topbar}</div>
        )}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
        {/* Safe area bar — padding for iPhone home indicator swipe zone.
          Shows the platform URL so the space isn't wasted. On devices
          without a home indicator (env() resolves to 0) the bar is
          invisible. */}
        <div className="shrink-0 border-t border-line bg-panel pb-[env(safe-area-inset-bottom,0px)] text-center">
          <a
            href="https://freegamestore.online"
            target="_blank"
            rel="noopener noreferrer"
            className="block py-[0.15rem] text-[0.55rem] font-semibold tracking-[0.03em] text-muted no-underline"
          >
            freegamestore.online
          </a>
        </div>
      </div>
    </SoundProvider>
  );
}
