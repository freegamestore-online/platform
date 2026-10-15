import type * as React from 'react';
import { useId, useState } from 'react';
import { GameButton } from './GameButton.js';
import { GameModal } from './GameModal.js';
import { LIGHT_COLOURS, MOTION_TOKENS, SHAPE_TOKENS, TYPOGRAPHY_TOKENS } from './tokens.js';

export interface StartScreenStep {
  /** Short name of the step, shown in bold. */
  heading: string;
  /** One or two sentences of explanation. */
  text: string;
}

export interface StartScreenProps {
  /** The game's display name, set large in the display face. */
  title: string;
  /** One line under the title. */
  tagline?: string;
  /**
   * Decorative art above the title, such as a mosaic or a logo. It is hidden
   * from assistive technology, because the title already names the game.
   */
  artwork?: React.ReactNode;
  /** Label for the main button. Default "Play". */
  playLabel?: string;
  /** Called when the player taps Play. */
  onPlay: () => void;
  /**
   * Called when the player taps How to play. Use this when the game shows its
   * own rules screen. When it is omitted, `howToPlay` steps open the SDK's overlay.
   */
  onHowToPlay?: () => void;
  /**
   * Numbered steps for the built-in How to play overlay. Used only when
   * `onHowToPlay` is not given. Omit both to hide the button.
   */
  howToPlay?: readonly StartScreenStep[];
}

/** A CSS variable with a fallback taken from the #209 light tokens, so the screen renders without GAME_TOKENS_CSS. */
const v = (name: string, fallback: string) => `var(--${name}, ${fallback})`;

/**
 * Styles for the start screen and its how-to-play list. The durations and
 * easings come from the motion tokens, and everything stops under
 * prefers-reduced-motion. Class names carry the `fgs-` prefix, so they cannot
 * collide with a game's own styles.
 */
export const START_SCREEN_CSS = `
.fgs-start {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(0.75rem, 3svh, 1.5rem);
  height: 100%;
  padding: 1rem;
  overflow: hidden;
  background:
    radial-gradient(120% 70% at 50% 0%, ${v('accent-soft', LIGHT_COLOURS.accentSoft)} 0%, transparent 65%),
    ${v('paper', LIGHT_COLOURS.paper)};
}
.fgs-start-artwork { width: min(11rem, 52vw); }
.fgs-start-artwork-inner { animation: fgs-start-float 7s ease-in-out infinite; }
.fgs-start-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: min(20rem, 100%);
  padding: 1.5rem 1.25rem 1.25rem;
  border-radius: ${v('radius', SHAPE_TOKENS.radius)};
  text-align: center;
  background: ${v('panel', LIGHT_COLOURS.panel)};
  border: 1px solid ${v('line', LIGHT_COLOURS.line)};
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.4),
    0 1px 2px rgb(0 0 0 / 0.06),
    0 18px 32px -18px rgb(0 0 0 / 0.35);
}
.fgs-start-title {
  margin: 0;
  font-family: ${v('font-display', TYPOGRAPHY_TOKENS.fontDisplay)};
  font-weight: 800;
  font-optical-sizing: auto;
  font-variation-settings: "opsz" 144;
  font-size: ${v('text-display', TYPOGRAPHY_TOKENS.textDisplay)};
  line-height: 0.95;
  letter-spacing: -0.03em;
  color: ${v('ink', LIGHT_COLOURS.ink)};
  text-wrap: balance;
}
.fgs-start-tagline {
  margin: 0 0 0.5rem;
  max-width: 18rem;
  font-size: 0.95rem;
  line-height: 1.4;
  color: ${v('muted', LIGHT_COLOURS.muted)};
}
.fgs-start-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  margin-top: 0.25rem;
}
.fgs-start-enter {
  animation: fgs-start-rise ${v('motion-slow', MOTION_TOKENS.slow)} cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: var(--delay, 0ms);
}
@keyframes fgs-start-rise {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
}
@keyframes fgs-start-float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-4px) rotate(-1deg); }
}
.fgs-how-steps {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.fgs-how-steps li {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  animation: fgs-start-rise ${v('motion-base', MOTION_TOKENS.base)} ease-out both;
  animation-delay: calc(var(--i, 0) * 60ms);
}
.fgs-how-num {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.5rem;
  font-family: ${v('font-display', TYPOGRAPHY_TOKENS.fontDisplay)};
  font-weight: 800;
  color: #ffffff;
  background: ${v('accent', LIGHT_COLOURS.accent)};
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.35),
    0 2px 4px rgb(0 0 0 / 0.2);
}
.fgs-how-steps strong {
  display: block;
  font-weight: 700;
  color: ${v('ink', LIGHT_COLOURS.ink)};
}
.fgs-how-steps p {
  margin: 0.15rem 0 0;
  font-size: 0.9rem;
  line-height: 1.4;
  color: ${v('muted', LIGHT_COLOURS.muted)};
}
@media (prefers-reduced-motion: reduce) {
  .fgs-start-enter,
  .fgs-start-artwork-inner,
  .fgs-how-steps li {
    animation: none;
  }
}
`;

/** Entrance delay for one element, so the screen rises in a sequence. */
const delay = (ms: number) => ({ '--delay': `${ms}ms` }) as React.CSSProperties;

/** The numbered steps of a game's rules. */
function HowToPlaySteps({ steps }: { steps: readonly StartScreenStep[] }) {
  return (
    <ol className="fgs-how-steps">
      {steps.map((step, i) => (
        <li key={step.heading} style={{ '--i': i } as React.CSSProperties}>
          <span className="fgs-how-num" aria-hidden="true">
            {i + 1}
          </span>
          <div>
            <strong>{step.heading}</strong>
            <p>{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * A game's start screen: artwork, title, tagline, then Play and How to play.
 * Motion is CSS only, and it stops under prefers-reduced-motion.
 *
 * The screen does not define the brand tokens. It falls back to the #209
 * light values, so a game that loads GAME_TOKENS_CSS gets the full theme.
 */
export function StartScreen({
  title,
  tagline,
  artwork,
  playLabel = 'Play',
  onPlay,
  onHowToPlay,
  howToPlay,
}: StartScreenProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const titleId = useId();
  const showsHelp = onHowToPlay !== undefined || howToPlay !== undefined;

  const openHelp = () => {
    if (onHowToPlay) onHowToPlay();
    else setHelpOpen(true);
  };

  return (
    <section className="fgs-start" aria-labelledby={titleId}>
      <style>{START_SCREEN_CSS}</style>
      {artwork !== undefined && artwork !== null && (
        <div className="fgs-start-artwork fgs-start-enter" style={delay(0)} aria-hidden="true">
          <div className="fgs-start-artwork-inner">{artwork}</div>
        </div>
      )}
      <div className="fgs-start-card fgs-start-enter" style={delay(120)}>
        <h1 id={titleId} className="fgs-start-title">
          {title}
        </h1>
        {tagline && <p className="fgs-start-tagline">{tagline}</p>}
        <div className="fgs-start-actions">
          <GameButton variant="primary" size="lg" block onClick={onPlay}>
            {playLabel}
          </GameButton>
          {showsHelp && (
            <GameButton variant="secondary" size="md" block onClick={openHelp}>
              How to play
            </GameButton>
          )}
        </div>
      </div>
      {onHowToPlay === undefined && howToPlay !== undefined && (
        <GameModal open={helpOpen} onClose={() => setHelpOpen(false)} title="How to play">
          <HowToPlaySteps steps={howToPlay} />
        </GameModal>
      )}
    </section>
  );
}
