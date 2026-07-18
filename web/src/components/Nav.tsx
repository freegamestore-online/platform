import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

const NAV_LINKS: { to: string; label: string; external: boolean }[] = [
  // "My Games" is the overview (list + slots + play/code/edit); "Studio" is
  // the AI build surface. Keep both inside the same creator console.
  { to: "/", label: "My Games", external: false },
  { to: "/create", label: "Studio", external: false },
  { to: "https://freegamestore.online", label: "Store", external: true },
  { to: "https://freegamestore.online/contribute.html", label: "Dev Docs", external: true },
];

const mobileLink: React.CSSProperties = {
  color: "var(--muted)", minHeight: 44, display: "flex", alignItems: "center",
};

function NavLink({ link, className, style, onClick }: {
  link: { to: string; label: string; external: boolean };
  className: string; style: React.CSSProperties; onClick?: () => void;
}) {
  return link.external ? (
    <a href={link.to} className={className} style={style} onClick={onClick}>{link.label}</a>
  ) : (
    <Link to={link.to} className={className} style={style} onClick={onClick}>{link.label}</Link>
  );
}

export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, signIn } = useAuth();

  return (
    <header className="border-b sticky top-0 z-30" style={{ borderColor: "var(--border)", padding: "0.75rem 0", background: "var(--bg)" }}>
      <div className="max-w-3xl mx-auto px-4 flex items-center justify-between">
        <Link to="/" className="text-xl font-extrabold tracking-tight no-underline" style={{ color: "var(--ink)", fontFamily: "Fraunces, serif" }}>
          Free<span style={{ color: "var(--accent)" }}>Game</span>Store
        </Link>

        <nav className="hidden sm:flex items-center gap-5">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} link={link} className="text-sm font-semibold no-underline" style={{ color: "var(--muted)" }} />
          ))}
          {user ? (
            <Link to="/profile">
              <img src={user.avatarUrl} alt={user.github} width={28} height={28} className="rounded-full border-2"
                style={{ width: 28, height: 28, borderColor: "var(--border)", minWidth: 28, minHeight: 28 }} />
            </Link>
          ) : (
            <button onClick={signIn} className="text-sm font-semibold no-underline"
              style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
              Sign in
            </button>
          )}
        </nav>

        {/* flex lives in the class, NOT inline — an inline `display` would beat
            `sm:hidden` and leave the hamburger showing next to the desktop nav. */}
        <button className="sm:hidden flex items-center justify-center" onClick={() => setMenuOpen(true)} aria-label="Menu"
          style={{ background: "none", border: "none", color: "var(--ink)", cursor: "pointer", minWidth: 44, minHeight: 44 }}>
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {menuOpen && <MobileDrawer user={user} signIn={signIn} onClose={() => setMenuOpen(false)} />}
    </header>
  );
}

function MobileDrawer({ user, signIn, onClose }: {
  user: { github: string; avatarUrl: string } | null;
  signIn: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} role="presentation" />
      <nav className="fixed top-0 right-0 z-50 flex flex-col gap-1 p-4"
        style={{ width: 220, height: "100dvh", background: "var(--surface)", borderLeft: "1px solid var(--border)", boxShadow: "-4px 0 20px rgba(0,0,0,0.3)" }}>
        <button onClick={onClose} className="self-end mb-2 flex items-center justify-center" aria-label="Close menu"
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", minWidth: 44, minHeight: 44 }}>
          <X className="w-5 h-5" />
        </button>
        {NAV_LINKS.map((link) => (
          <NavLink key={link.to} link={link} className="block py-2 text-base font-semibold no-underline" style={mobileLink} onClick={onClose} />
        ))}
        {user ? (
          <Link to="/profile" className="flex items-center gap-2 mt-4 no-underline" style={{ minHeight: 44 }} onClick={onClose}>
            <img src={user.avatarUrl} alt={user.github} className="rounded-full" style={{ width: 24, height: 24 }} />
            <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>@{user.github}</span>
          </Link>
        ) : (
          <button onClick={() => { onClose(); signIn(); }} className="mt-4 text-sm font-semibold"
            style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: 0, minHeight: 44 }}>
            Sign in with GitHub
          </button>
        )}
      </nav>
    </>
  );
}
