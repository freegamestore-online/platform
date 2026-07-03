import { Nav } from "./Nav";

const centerStyle = { minHeight: "calc(100dvh - 60px)" };

/** Full-page loading spinner with Nav. */
export function LoadingShell() {
  return (
    <>
      <Nav />
      <div className="flex items-center justify-center" style={centerStyle}>
        <div className="w-8 h-8 border-3 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    </>
  );
}

/** Full-page sign-in prompt with Nav. */
export function SignInShell({ onSignIn, message }: { onSignIn: () => void; message: string }) {
  return (
    <>
      <Nav />
      <div className="flex items-center justify-center px-4" style={centerStyle}>
        <div className="text-center max-w-md">
          <p className="mb-4" style={{ color: "var(--muted)" }}>{message}</p>
          <button
            onClick={onSignIn}
            className="px-6 font-semibold rounded-xl"
            style={{
              minHeight: 44,
              background: "var(--accent)",
              color: "#000",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign in with GitHub
          </button>
        </div>
      </div>
    </>
  );
}

/** Full-page error message with Nav. When `onRetry` is given, offers a retry
 *  button — `/api/me` returns a retryable 503 on a registry blip, and without a
 *  control the whole page dead-ends until a manual browser reload. */
export function ErrorShell({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <>
      <Nav />
      <div className="flex items-center justify-center px-4" style={centerStyle}>
        <div className="text-center max-w-md">
          <p className="text-lg font-semibold mb-4" style={{ color: "var(--error)" }}>{message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-6 font-semibold rounded-xl"
              style={{ minHeight: 44, background: "var(--accent)", color: "#000", border: "none", cursor: "pointer", fontFamily: "inherit" }}
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </>
  );
}
