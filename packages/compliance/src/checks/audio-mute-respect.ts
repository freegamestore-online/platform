import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Any code that produces sound from the page directly — Web Audio API,
 * <audio> elements, or kaplay's loadSound. These all play on the user's
 * speakers; if the project ships them without checking the platform mute
 * state, the topbar Mute button is a lie and users get blasted with audio
 * they thought they'd silenced.
 *
 * Boundary picked to be cheap-grep accurate, not exhaustive: it catches the
 * common shapes seen in our games (bowling's SoundFX, simon's playTone) and
 * leaves rare patterns (Howler, Tone.js) to be added when they appear.
 */
const RAW_AUDIO_RE =
  /\bnew\s+AudioContext\(|\bwebkitAudioContext\b|\bnew\s+Audio\(|<audio[\s>]|\.loadSound\(/;

/**
 * The two SDK hooks that integrate with the platform mute toggle.
 * - useGameSounds(): synthesized SFX, auto-mute-respecting. The 90% path.
 * - useSound(): exposes { muted, toggle } for games doing their own audio.
 */
const SDK_MUTE_RE = /\buseGameSounds\b|\buseSound\b/;

const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.html']);

export async function checkAudioMuteRespect(source: FileSource): Promise<CheckResult> {
  const rawAudioFiles: string[] = [];
  let sdkAware = false;

  for await (const path of source.list()) {
    if (!SCAN_EXTS.has(extOf(path))) continue;
    const content = await source.read(path);
    if (!content) continue;
    if (RAW_AUDIO_RE.test(content)) rawAudioFiles.push(path);
    if (SDK_MUTE_RE.test(content)) sdkAware = true;
  }

  if (rawAudioFiles.length === 0) {
    return {
      name: 'Audio respects platform mute',
      status: 'pass',
      detail: 'no raw audio APIs in use',
    };
  }

  if (sdkAware) {
    return {
      name: 'Audio respects platform mute',
      status: 'pass',
      detail: `raw audio in ${rawAudioFiles.length} file(s); SDK mute hook is imported`,
    };
  }

  return {
    name: 'Audio respects platform mute',
    status: 'fail',
    detail: `raw audio APIs in ${rawAudioFiles.length} file(s) without SDK mute integration: ${rawAudioFiles
      .slice(0, 3)
      .join(', ')}${rawAudioFiles.length > 3 ? '…' : ''}`,
    suggestions: [
      'Easiest: replace your audio with useGameSounds() from @freegamestore/games — synthesized SFX with the topbar Mute button wired in automatically.',
      'For game-specific sounds (bowling pin crash, simon tones), keep your code but import useSound() and gate playback on `muted === false`.',
    ],
  };
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}
