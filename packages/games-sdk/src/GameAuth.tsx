import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth.js';

/** Shared by the sign-in and avatar buttons: bare, 44px minimum touch target. */
const BARE_BUTTON =
  'm-0 inline-flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center border-0 bg-transparent p-0 [-webkit-tap-highlight-color:transparent]';

/**
 * Sign-in / avatar widget for the GameTopbar `actions` slot.
 *
 * When not signed in: shows a small "Sign in" text button.
 * When signed in: shows the user's avatar + first name, with a
 * dropdown containing "Sign out".
 */
export function GameAuth(): React.JSX.Element {
  const { user, loading, signIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [open]);

  if (loading) return <div />;

  if (user === null) {
    return (
      <button onClick={signIn} className={`${BARE_BUTTON} text-[0.7rem] font-semibold text-muted`}>
        Sign in
      </button>
    );
  }

  const firstName = user.name.split(' ')[0] ?? user.name;
  // Google accounts without a profile picture have an empty avatar URL;
  // render an initial-letter circle instead of a broken <img>.
  const avatarUrl = user.avatar?.trim();
  const initial = (firstName.charAt(0) || '?').toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className={`${BARE_BUTTON} gap-[0.35rem]`}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            width={24}
            height={24}
            className="size-6 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[0.65rem] font-bold leading-none text-white"
          >
            {initial}
          </span>
        )}
        <span className="whitespace-nowrap text-[0.7rem] font-semibold text-ink">{firstName}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[100] mt-1 min-w-28 rounded-lg border border-line bg-panel shadow-[0_4px_12px_rgb(0_0_0/0.1)]">
          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="flex min-h-11 w-full cursor-pointer touch-manipulation items-center border-0 bg-transparent px-3 py-2 text-[0.7rem] font-semibold text-ink [-webkit-tap-highlight-color:transparent]"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
