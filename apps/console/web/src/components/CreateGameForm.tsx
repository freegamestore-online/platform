import { useEffect, useRef, useState } from 'react';
import { reportError } from '../lib/errorReporter';
import { buildInitialPrompt, queueInitialBuild } from '../lib/initialBuild';
import { Button, Card, Input, Label, Select } from './ui';

const FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      credentials: options.credentials ?? 'include',
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const msg = `Request to ${new URL(url, location.href).pathname} timed out after ${FETCH_TIMEOUT_MS}ms`;
      reportError({ message: msg, context: 'fetchWithTimeout' });
      throw new Error(msg);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface ProvisionStep {
  name: string;
  status: string;
  detail: string;
}

// Canonical game categories (synced with @freegamestore/compliance)
const GAME_CATEGORIES = [
  { value: 'strategy', label: 'Strategy' },
  { value: 'brain-training', label: 'Brain Training' },
  { value: 'arcade', label: 'Arcade' },
  { value: 'racing', label: 'Racing' },
  { value: 'sports', label: 'Sports' },
  { value: 'cards', label: 'Cards' },
  { value: 'casual', label: 'Casual' },
  { value: 'puzzle', label: 'Puzzle' },
  { value: 'board', label: 'Board' },
  { value: 'rpg', label: 'RPG' },
  { value: 'action', label: 'Action' },
  { value: 'other', label: 'Other (specify in description)' },
];

const CATEGORIES = GAME_CATEGORIES;

// The three headline engines a creator builds on. The agent authors real engine
// code (KAPLAY verbs / Phaser scenes / react-three-fiber) rather than hand-rolling
// a game loop and physics, so games come out playable, not truncated.
const ENGINES = [
  {
    value: 'kaplay',
    label: 'KAPLAY',
    tag: 'Easiest · 2D',
    desc: 'Beginner-friendly 2D arcade engine. Sprites, input, gravity and collisions as one-line verbs — the fastest path to a playable game.',
  },
  {
    value: 'phaser',
    label: 'Phaser',
    tag: 'Powerful · 2D',
    desc: 'The industry-standard 2D engine. Scenes, arcade physics, tilemaps and tweens — for platformers, shooters and bigger games.',
  },
  {
    value: '3d',
    label: 'Three.js',
    tag: '3D',
    desc: 'react-three-fiber + Three.js for 3D worlds, racing and flying games.',
  },
  {
    value: 'pixi',
    label: 'Pixi.js',
    tag: 'WebGL · 2D',
    desc: 'High-performance WebGL 2D renderer — particles, filters and buttery sprite scenes.',
  },
  {
    value: 'babylon',
    label: 'Babylon.js',
    tag: '3D',
    desc: 'Full 3D engine with cameras, lights, materials and physics-ready meshes.',
  },
  {
    value: 'excalibur',
    label: 'Excalibur',
    tag: 'TS · 2D',
    desc: 'TypeScript-native actor engine — game objects are typed classes with physics built in.',
  },
  {
    value: 'littlejs',
    label: 'LittleJS',
    tag: 'tiny · 2D',
    desc: 'All-in-one arcade engine: particles and procedural sound built in, zero asset files.',
  },
];

// No-engine starters for creators who want full control or a DOM-based board.
const STARTERS = [
  {
    value: 'canvas',
    label: 'Raw Canvas',
    desc: 'Hand-rolled HTML5 canvas 2D — full control, no engine.',
  },
  { value: 'grid', label: 'Grid', desc: 'CSS-grid board for puzzles, match-3 and word games.' },
  { value: 'cards', label: 'Cards', desc: 'DOM card layout for solitaire and memory games.' },
];

const ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const RESERVED_IDS = new Set([
  'freegamestore',
  'submissions',
  'template-game-canvas',
  'template-game-3d',
  'template-game-grid',
  'template-game-cards',
  'template-game-kaplay',
  'template-game-phaser',
  'template-game-pixi',
  'template-game-babylon',
  'template-game-excalibur',
  'template-game-littlejs',
  'brand',
  'ops',
  'sdk',
]);

function validateId(id: string): string | null {
  if (!id) return null;
  if (id.length < 3) return '3 chars min';
  if (id.length > 58) return '58 chars max';
  if (!/^[a-z0-9-]*$/.test(id)) return 'Lowercase letters, numbers, dashes only';
  if (!ID_RE.test(id)) return 'Cannot start or end with a dash';
  if (id.startsWith('free') || id.startsWith('pro')) return "Cannot start with 'free' or 'pro'";
  if (id.startsWith('template-game-') || RESERVED_IDS.has(id)) return 'Reserved id';
  return null;
}

/** Derive a valid game id from a display name so creators don't have to invent a
 *  slug — lowercase, non-alphanumerics collapsed to dashes, no leading/trailing
 *  dash, capped at 58 chars. Matches the id rules validateId enforces. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 58)
    .replace(/-+$/, '');
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' ? 'bg-emerald-500' : status === 'skip' ? 'bg-yellow-500' : 'bg-red-500';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />;
}

interface CreateGameFormProps {
  /** Called on a successful create with the new game id — the Dashboard reloads
   *  its game list so the new game appears (no more full-page reload needed). */
  onCreated: (id: string, prompt: string) => void | Promise<void>;
  /** Close the form and return to the game list. */
  onClose: () => void;
}

/** Self-contained game creation form with validation, provisioning, and result display. */
export function CreateGameForm({ onCreated, onClose }: CreateGameFormProps) {
  const [gameId, setGameId] = useState('');
  const [gameName, setGameName] = useState('');
  const [category, setCategory] = useState('casual');
  const [icon, setIcon] = useState('\uD83C\uDFAE');
  const [iconBg, setIconBg] = useState('#1a2e26');
  const [description, setDescription] = useState('');
  const [buildPrompt, setBuildPrompt] = useState('');
  // Default to KAPLAY — the easiest 2D engine — so a new/kid creator gets the
  // fastest path to a playable game. Every engine + starter stays selectable.
  const [template, setTemplate] = useState('kaplay');
  // Remix: optionally start from an existing published game's code. When set, the
  // new game inherits that game's engine (the template picker is ignored).
  const [cloneFrom, setCloneFrom] = useState('');
  const [catalog, setCatalog] = useState<{ id: string; name: string }[]>([]);
  // The id is auto-derived from the name until the creator edits it by hand.
  const [idTouched, setIdTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ steps: ProvisionStep[]; success: boolean } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ available: boolean; reason?: string } | null>(
    null,
  );

  const idError = validateId(gameId);

  // Always holds the latest id so an in-flight availability check can tell if the
  // user edited the id while it was running (and ignore its now-stale result).
  const latestIdRef = useRef(gameId);
  latestIdRef.current = gameId;

  // Auto-check availability (debounced) as the id changes, so the creator only
  // has to think about the id if the auto-derived slug is taken — no button.
  useEffect(() => {
    setCheckResult(null);
    if (!gameId || idError) {
      setChecking(false);
      return;
    }
    const checkedId = gameId;
    setChecking(true);

    const abortController = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/check-id?id=${encodeURIComponent(checkedId)}`, {
          credentials: 'include',
          signal: abortController.signal,
        });
        if (!r.ok) {
          reportError({
            message: `ID check failed: ${r.status} ${r.statusText}`,
            context: `id=${checkedId}`,
          });
        }
        const d = (await r.json().catch(() => ({}))) as { available?: boolean; reason?: string };
        if (latestIdRef.current !== checkedId) return; // id changed mid-flight → stale
        setCheckResult({ available: !!d.available, reason: d.reason });
      } catch (e) {
        if (latestIdRef.current !== checkedId) return;
        if (e instanceof Error && e.name === 'AbortError') return; // cancelled by cleanup
        reportError({
          message: `ID availability check failed: ${e instanceof Error ? e.message : String(e)}`,
          context: `id=${checkedId}`,
        });
        setCheckResult({ available: false, reason: "Couldn't check — try again" });
      } finally {
        if (latestIdRef.current === checkedId) setChecking(false);
      }
    }, 450);

    return () => {
      clearTimeout(t);
      abortController.abort();
    };
  }, [gameId, idError]);

  // Load the public catalog once for the "Remix an existing game" picker.
  useEffect(() => {
    let live = true;
    fetchWithTimeout('/api/catalog')
      .then((r) => r.json())
      .then((d: { games?: { id: string; name: string }[] }) => {
        if (live && Array.isArray(d.games)) {
          setCatalog(d.games.slice().sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch((e) => {
        if (live) {
          reportError({
            message: `Catalog fetch failed: ${e instanceof Error ? e.message : String(e)}`,
            context: 'catalog-load',
          });
        }
      });
    return () => {
      live = false;
    };
  }, []);

  const handleClear = () => {
    setGameName('');
    setGameId('');
    setIdTouched(false);
    setCategory('casual');
    setIcon('🎮');
    setIconBg('#1a2e26');
    setDescription('');
    setBuildPrompt('');
    setCloneFrom('');
    setTemplate('kaplay');
    setSubmitError(null);
    setCheckResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setSubmitError(null);

    try {
      const createRes = await fetchWithTimeout('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: gameId,
          name: gameName,
          category,
          icon,
          iconBg,
          description,
          template,
          ...(cloneFrom ? { cloneFrom } : {}),
        }),
      });
      const createData = (await createRes.json().catch(() => ({}))) as {
        steps?: ProvisionStep[];
        success?: boolean;
        error?: string;
      };
      if (!createRes.ok || createData.error) {
        const error = createData.error || `Create failed (${createRes.status})`;
        reportError({
          message: error,
          context: `game=${gameId}, status=${createRes.status}`,
        });
        setSubmitError(error);
      } else if (createData.success || createData.steps) {
        setResult({ steps: createData.steps ?? [], success: createData.success ?? false });
        if (createData.success) {
          const prompt = buildInitialPrompt({
            gameName,
            gameId,
            category,
            description,
            template,
            cloneFrom,
            buildPrompt,
          });
          queueInitialBuild(gameId, prompt);
          await onCreated(gameId, prompt);
        }
      } else {
        setSubmitError('Unexpected response from the server');
        reportError({
          message: 'Unexpected create response format',
          context: `game=${gameId}, response=${JSON.stringify(createData)}`,
        });
      }
    } catch (e) {
      const error = e instanceof Error ? `Request failed: ${e.message}` : 'Network error';
      reportError({ message: error, context: `game=${gameId}` });
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold">
          {result.success ? 'Game Created' : 'Provisioning Failed'}
        </h3>
        <div className="space-y-2">
          {result.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <StatusDot status={step.status} />
              <span className="font-medium w-28 shrink-0">{step.name}</span>
              <span className="text-muted">{step.detail}</span>
            </div>
          ))}
        </div>
        {result.success && (
          <div className="pt-2 text-sm space-y-1 text-muted">
            <p>
              Your game is live at{' '}
              <a
                href={`https://${gameId}.freegamestore.online`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline text-accent"
              >
                {gameId}.freegamestore.online
              </a>
            </p>
            <p>
              Edit your code at{' '}
              <a
                href={`https://github.com/freegamestore-online/${gameId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline text-accent"
              >
                github.com/freegamestore-online/{gameId}
              </a>
            </p>
          </div>
        )}
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card className="p-6 space-y-5">
        <h3 className="text-lg font-semibold">Create a New Game</h3>

        <div>
          <Label htmlFor="game-name">Game Name</Label>
          <Input
            id="game-name"
            type="text"
            value={gameName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const v = e.target.value;
              setGameName(v);
              if (!idTouched) setGameId(slugify(v)); // auto-derive the id until edited by hand
            }}
            placeholder="My Awesome Game"
            required
          />
        </div>

        <div>
          <Label htmlFor="game-id">Game address</Label>
          <Input
            id="game-id"
            type="text"
            value={gameId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setIdTouched(true);
              setGameId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
            }}
            placeholder="my-awesome-game"
            required
            className={
              idError || (checkResult && !checkResult.available) ? 'border-danger!' : undefined
            }
          />
          {idError ? (
            <p className="text-sm mt-1 text-danger">{idError}</p>
          ) : checking ? (
            <p className="text-sm mt-1 text-muted">Checking {gameId}.freegamestore.online…</p>
          ) : checkResult ? (
            checkResult.available ? (
              <p className="text-sm mt-1 text-accent">
                ✓ {gameId}.freegamestore.online is available
              </p>
            ) : (
              <p className="text-sm mt-1 text-danger">
                ✗ {checkResult.reason || 'That address is taken — edit it'}
              </p>
            )
          ) : gameId ? (
            <p className="text-sm mt-1 text-muted">{gameId}.freegamestore.online</p>
          ) : (
            <p className="text-sm mt-1 text-muted">Auto-filled from the name — edit if you like</p>
          )}
        </div>

        <div>
          <Label htmlFor="game-category">Category</Label>
          <Select id="game-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <Label htmlFor="game-icon">Icon (emoji)</Label>
            <Input
              id="game-icon"
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="text-center text-2xl"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="game-icon-bg">Icon Background</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={iconBg}
                onChange={(e) => setIconBg(e.target.value)}
                aria-label="Icon background color picker"
                className="w-11 h-11 rounded-lg border-0 cursor-pointer p-0"
              />
              <Input
                id="game-icon-bg"
                type="text"
                value={iconBg}
                onChange={(e) => setIconBg(e.target.value)}
                className="flex-1 font-mono"
              />
            </div>
          </div>
        </div>

        <div>
          <Label htmlFor="game-desc">One-line Description</Label>
          <Input
            id="game-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A fun and addictive puzzle game"
          />
        </div>

        <div>
          <Label htmlFor="build-prompt">First AI Prompt</Label>
          <textarea
            id="build-prompt"
            value={buildPrompt}
            onChange={(e) => setBuildPrompt(e.target.value)}
            placeholder="Build the first playable version: controls, levels, scoring, win/lose state, and deploy it."
            className="w-full resize-y rounded-lg border border-line bg-paper text-ink text-sm px-3 py-2.5 font-sans min-h-[92px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent"
            rows={3}
          />
          <p className="text-xs mt-1 text-muted">
            This is sent automatically when the studio opens, so the AI starts building without
            waiting.
          </p>
        </div>

        <div>
          <Label htmlFor="remix-from">Start from an existing game (optional)</Label>
          <Select id="remix-from" value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
            <option value="">— Start fresh (choose an engine below) —</option>
            {catalog.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          {cloneFrom ? (
            <p className="text-xs mt-1 text-accent">
              Remixing <strong>{catalog.find((g) => g.id === cloneFrom)?.name || cloneFrom}</strong>{' '}
              — your game starts from its code (all games are open-source / MIT) and keeps its
              engine. You'll tweak it in the studio.
            </p>
          ) : (
            <p className="text-xs mt-1 text-muted">
              Remix any published game as your starting point, or leave blank to start fresh.
            </p>
          )}
        </div>

        <fieldset disabled={!!cloneFrom} className={cloneFrom ? 'opacity-50' : undefined}>
          <legend className="block text-sm font-medium mb-1">
            Engine{cloneFrom ? ' — inherited from the remixed game' : ''}
          </legend>
          <p className="text-xs mb-2 text-muted">
            {cloneFrom
              ? "The game you're remixing keeps its own engine — no need to choose here."
              : 'Build on a game engine (the AI writes real engine code), or start from a simple no-engine template.'}
          </p>

          <p className="text-xs font-medium mb-1 text-muted">Game engines</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {ENGINES.map((t) => (
              <label
                key={t.value}
                className={`flex flex-col gap-1 p-3 rounded-lg cursor-pointer border ${
                  template === t.value ? 'bg-accent-soft border-accent' : 'bg-paper border-line'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="template"
                    value={t.value}
                    checked={template === t.value}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="accent-emerald-500"
                  />
                  <span className="font-medium text-sm">{t.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full ml-auto whitespace-nowrap bg-panel text-muted border border-line">
                    {t.tag}
                  </span>
                </span>
                <span className="text-xs text-muted">{t.desc}</span>
              </label>
            ))}
          </div>

          <p className="text-xs font-medium mt-3 mb-1 text-muted">No-engine starters</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {STARTERS.map((t) => (
              <label
                key={t.value}
                className={`flex flex-col gap-1 p-3 rounded-lg cursor-pointer border ${
                  template === t.value ? 'bg-accent-soft border-accent' : 'bg-paper border-line'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="template"
                    value={t.value}
                    checked={template === t.value}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="accent-emerald-500"
                  />
                  <span className="font-medium text-sm">{t.label}</span>
                </span>
                <span className="text-xs text-muted">{t.desc}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {submitError && <p className="text-sm font-medium text-danger">{submitError}</p>}

        <div className="flex gap-3 pt-2">
          <Button
            type="submit"
            variant="primary"
            disabled={
              submitting ||
              !gameId ||
              !gameName ||
              !!idError ||
              (checkResult ? !checkResult.available : false)
            }
          >
            {submitting ? 'Creating...' : 'Create Game'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleClear}
            disabled={submitting}
            title="Reset all fields to defaults"
          >
            Clear
          </Button>
        </div>
      </Card>
    </form>
  );
}
