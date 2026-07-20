import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyTextSize, getTextSize } from "./lib/textSize";

// Apply the saved text-size preference before first paint so it survives reloads
// without a flash of default-size text.
applyTextSize(getTextSize());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
