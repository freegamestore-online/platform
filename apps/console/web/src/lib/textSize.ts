/** Studio text-size preference. Mirrors the games-SDK GameTextSizeToggle: a
 *  `data-text` attribute on <html> scales the root font-size (index.css), so all
 *  rem-based UI text (chat, labels, buttons) grows/shrinks together. Persisted
 *  in localStorage and applied before first paint (main.tsx) so it survives
 *  reloads without a flash. */

export type TextSize = "sm" | "default" | "lg" | "xl";

// Same key the games use, so the choice reads naturally across surfaces
// (localStorage is per-origin, so there's no actual cross-app collision).
const KEY = "stores-text-size";

export const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "default", label: "Default" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Extra large" },
];

export function getTextSize(): TextSize {
  if (typeof window === "undefined") return "default";
  const s = window.localStorage.getItem(KEY);
  return s === "sm" || s === "lg" || s === "xl" ? s : "default";
}

export function applyTextSize(size: TextSize): void {
  if (typeof document !== "undefined") {
    if (size === "default") delete document.documentElement.dataset.text;
    else document.documentElement.dataset.text = size;
  }
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, size);
}
