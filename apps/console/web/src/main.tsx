import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { reportError } from "./lib/errorReporter";
import { applyTextSize, getTextSize } from "./lib/textSize";

// Apply the saved text-size preference before first paint so it survives reloads
// without a flash of default-size text.
applyTextSize(getTextSize());

// Global error handlers — catch errors that escape React's tree (e.g. async
// callbacks, setTimeout, third-party scripts). Installed once at app init;
// deduplication/debouncing is handled inside reportError.
window.onerror = (message, _source, _lineno, _colno, error) => {
  reportError({
    route: location.pathname,
    message: typeof message === "string" ? message : String(message),
    stack: error?.stack,
    context: "window.onerror",
  });
  // Return false so the browser still logs to the console.
  return false;
};

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason ?? "Unhandled promise rejection");
  reportError({
    route: location.pathname,
    message,
    stack: reason instanceof Error ? reason.stack : undefined,
    context: "unhandledrejection",
  });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
