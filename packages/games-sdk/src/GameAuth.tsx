import type * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from './useAuth.js';

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
      <button
        onClick={signIn}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: '"Manrope", system-ui, sans-serif',
          fontSize: '0.7rem',
          fontWeight: 600,
          color: 'var(--muted, #6b7280)',
          padding: 0,
          margin: 0,
          // 44px minimum touch target
          minWidth: '44px',
          minHeight: '44px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        }}
      >
        Sign in
      </button>
    );
  }

  const firstName = user.name.split(' ')[0] ?? user.name;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: 0,
          margin: 0,
          minWidth: '44px',
          minHeight: '44px',
          justifyContent: 'center',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        }}
      >
        <img
          src={user.avatar}
          alt=""
          width={24}
          height={24}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            objectFit: 'cover',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: '"Manrope", system-ui, sans-serif',
            fontSize: '0.7rem',
            fontWeight: 600,
            color: 'var(--ink, #1a1a1a)',
            whiteSpace: 'nowrap',
          }}
        >
          {firstName}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '0.25rem',
            background: 'var(--panel, #fff)',
            border: '1px solid var(--line, #e5e5e5)',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 100,
            minWidth: '7rem',
          }}
        >
          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: '"Manrope", system-ui, sans-serif',
              fontSize: '0.7rem',
              fontWeight: 600,
              color: 'var(--ink, #1a1a1a)',
              padding: '0.5rem 0.75rem',
              minHeight: '44px',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
