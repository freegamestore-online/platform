import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ThemeToggle } from './ThemeToggle';

const ICON_SIZE_DESKTOP = 28;

const NAV_LINKS: { to: string; label: string; external: boolean }[] = [
  // "My Games" is the overview (list + slots + play/code/edit); "Studio" is
  // the AI build surface. Keep both inside the same creator console.
  { to: '/', label: 'My Games', external: false },
  { to: '/create', label: 'Studio', external: false },
  { to: 'https://freegamestore.online', label: 'Store', external: true },
  { to: 'https://freegamestore.online/contribute.html', label: 'Dev Docs', external: true },
];

const MOBILE_LINK = 'flex min-h-11 items-center text-muted';
const DESKTOP_LINK = 'text-muted';

function NavLink({
  link,
  className,
  onClick,
}: {
  link: { to: string; label: string; external: boolean };
  className: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return link.external ? (
    <a href={link.to} className={className} onClick={onClick}>
      {link.label}
    </a>
  ) : (
    <Link to={link.to} className={className} onClick={onClick}>
      {link.label}
    </Link>
  );
}

export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, signIn } = useAuth();

  return (
    <header className="border-b border-line bg-paper py-3 sticky top-0 z-30">
      <div className="max-w-3xl mx-auto px-4 flex items-center justify-between">
        <Link
          to="/"
          className="font-display text-xl font-extrabold tracking-tight text-ink no-underline"
        >
          Free<span className="text-accent">Game</span>Store
        </Link>

        <nav className="hidden sm:flex items-center gap-5">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              link={link}
              className={`text-sm font-semibold no-underline ${DESKTOP_LINK}`}
            />
          ))}
          <ThemeToggle compact />
          {user ? (
            <Link to="/profile" aria-label={`Profile for ${user.github}`}>
              <img
                src={user.avatarUrl}
                alt={user.github}
                width={ICON_SIZE_DESKTOP}
                height={ICON_SIZE_DESKTOP}
                className="size-7 min-h-7 min-w-7 rounded-full border-2 border-line"
              />
            </Link>
          ) : (
            <button
              onClick={signIn}
              className="cursor-pointer border-0 bg-transparent text-sm font-semibold text-accent no-underline"
            >
              Sign in
            </button>
          )}
        </nav>

        {/* flex lives in the class, NOT inline — an inline `display` would beat
            `sm:hidden` and leave the hamburger showing next to the desktop nav. */}
        <button
          className="sm:hidden flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-0 bg-transparent text-ink"
          onClick={() => setMenuOpen(true)}
          aria-label="Menu"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {menuOpen && <MobileDrawer user={user} signIn={signIn} onClose={() => setMenuOpen(false)} />}
    </header>
  );
}

function MobileDrawer({
  user,
  signIn,
  onClose,
}: {
  user: { github: string; avatarUrl: string } | null;
  signIn: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-scrim"
        onClick={onClose}
        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Escape') onClose();
        }}
        role="presentation"
      />
      <nav className="fixed top-0 right-0 z-50 flex h-dvh w-[220px] flex-col gap-1 border-l border-line bg-panel p-4 shadow-elevated">
        <div className="mb-2 flex items-center justify-between">
          <ThemeToggle />
          <button
            onClick={onClose}
            className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-0 bg-transparent text-muted"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            link={link}
            className={`py-2 text-base font-semibold no-underline ${MOBILE_LINK}`}
            onClick={onClose}
          />
        ))}
        {user ? (
          <Link
            to="/profile"
            className="flex min-h-11 items-center gap-2 mt-4 no-underline"
            onClick={onClose}
            aria-label={`Profile for ${user.github}`}
          >
            <img src={user.avatarUrl} alt={user.github} className="size-6 rounded-full" />
            <span className="text-sm font-semibold text-ink">@{user.github}</span>
          </Link>
        ) : (
          <button
            onClick={() => {
              onClose();
              signIn();
            }}
            className="mt-4 min-h-11 cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-accent"
          >
            Sign in with GitHub
          </button>
        )}
      </nav>
    </>
  );
}
