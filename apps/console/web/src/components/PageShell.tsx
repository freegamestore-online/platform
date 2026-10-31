import { Nav } from './Nav';

const CENTER = 'min-h-[calc(100dvh-60px)]';

/** Full-page loading spinner with Nav. */
export function LoadingShell() {
  return (
    <>
      <Nav />
      <div className={`flex items-center justify-center ${CENTER}`}>
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
      <div className={`flex items-center justify-center px-4 ${CENTER}`}>
        <div className="text-center max-w-md">
          <p className="mb-4 text-muted">{message}</p>
          <button
            onClick={onSignIn}
            className="px-6 min-h-11 font-semibold rounded-xl bg-accent text-black border-0 cursor-pointer [font-family:inherit]"
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
      <div className={`flex items-center justify-center px-4 ${CENTER}`}>
        <div className="text-center max-w-md">
          <p className="text-lg font-semibold mb-4 text-danger">{message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-6 min-h-11 font-semibold rounded-xl bg-accent text-black border-0 cursor-pointer [font-family:inherit]"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </>
  );
}
