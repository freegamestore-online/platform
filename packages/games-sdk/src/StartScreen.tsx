import type * as React from 'react';
import { useId, useState } from 'react';
import { GameButton } from './GameButton.js';
import { GameModal } from './GameModal.js';

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

/** The numbered steps of a game's rules. */
function HowToPlaySteps({ steps }: { steps: readonly StartScreenStep[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-[0.85rem] p-0">
      {steps.map((step, i) => (
        <li
          key={step.heading}
          className="flex animate-fgs-rise-step items-start gap-3 motion-reduce:animate-none"
          // Dynamic: the entrance delay is staggered by the step's index.
          style={{ '--i': i } as React.CSSProperties}
        >
          <span
            className="grid size-7 flex-none place-items-center rounded-lg bg-accent font-display font-extrabold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_2px_4px_rgb(0_0_0/0.2)]"
            aria-hidden="true"
          >
            {i + 1}
          </span>
          <div>
            <strong className="block font-bold text-ink">{step.heading}</strong>
            <p className="m-0 mt-[0.15rem] text-[0.9rem] leading-[1.4] text-muted">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * A game's start screen: artwork, title, tagline, then Play and How to play.
 * Motion is the `animate-fgs-*` utilities from the SDK's `theme.css`, and it
 * stops under prefers-reduced-motion. The card sits on an opaque `bg-panel`.
 *
 * Colours come from the platform tokens through the game's `@theme` mapping.
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
    <section
      data-fgs="start"
      className="relative flex h-full flex-col items-center justify-center gap-[clamp(0.75rem,3svh,1.5rem)] overflow-hidden bg-paper bg-[radial-gradient(120%_70%_at_50%_0%,var(--color-accent-soft)_0%,transparent_65%)] p-4"
      aria-labelledby={titleId}
    >
      {artwork !== undefined && artwork !== null && (
        <div
          data-fgs="start-artwork"
          className="w-[min(11rem,52vw)] animate-fgs-rise [--delay:0ms] motion-reduce:animate-none"
          aria-hidden="true"
        >
          <div className="animate-fgs-float motion-reduce:animate-none">{artwork}</div>
        </div>
      )}
      <div className="flex w-[min(20rem,100%)] animate-fgs-rise flex-col items-center gap-2 rounded-fgs border border-line bg-panel px-5 pb-5 pt-6 text-center shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(0_0_0/0.06),0_18px_32px_-18px_rgb(0_0_0/0.35)] [--delay:120ms] motion-reduce:animate-none">
        <h1
          id={titleId}
          className="m-0 text-balance font-display text-fgs-display font-extrabold leading-[0.95] tracking-[-0.03em] text-ink [font-optical-sizing:auto] [font-variation-settings:'opsz'_144]"
        >
          {title}
        </h1>
        {tagline && (
          <p className="m-0 mb-2 max-w-72 text-[0.95rem] leading-[1.4] text-muted">{tagline}</p>
        )}
        <div className="mt-1 flex w-full flex-col gap-2">
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
