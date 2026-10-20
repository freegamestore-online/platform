import type { FileSource } from './file-source.js';
import { stripCommentsOnly } from './strip.js';

/**
 * Browser permissions a game may ask the player for, and how to spot them in
 * source (#370). Shared by `fgs check` (warns on an undeclared one), the
 * storefront listing scan (scripts/scan-game-permissions.mjs) and the listing
 * itself, so the ids, names and icons stay in one place.
 *
 * Detection is static and deliberately simple: it reads the game's own source
 * (`web/src/**` and `web/index.html`), never node_modules or a built bundle.
 * Engine bundles (Phaser, Babylon…) carry gamepad, orientation and camera code
 * whether a game uses it or not, so scanning them would tell players a game
 * wants the microphone when it never asks.
 */
export interface PermissionInfo {
  /** Stable id, used in `package.json` declarations and the listing data. */
  id: string;
  /** Plain name shown to players. */
  name: string;
  /** Emoji shown on the listing and on game cards. */
  icon: string;
  /** Whether the browser shows the player a prompt before granting it. */
  prompts: boolean;
}

export const PERMISSIONS: readonly PermissionInfo[] = [
  { id: 'motion', name: 'Motion sensors', icon: '📱', prompts: true },
  { id: 'microphone', name: 'Microphone', icon: '🎤', prompts: true },
  { id: 'camera', name: 'Camera', icon: '📷', prompts: true },
  { id: 'location', name: 'Location', icon: '📍', prompts: true },
  { id: 'notifications', name: 'Notifications', icon: '🔔', prompts: true },
  { id: 'midi', name: 'MIDI devices', icon: '🎹', prompts: true },
  { id: 'clipboard-read', name: 'Read clipboard', icon: '📋', prompts: true },
  { id: 'bluetooth', name: 'Bluetooth devices', icon: '🔵', prompts: true },
  { id: 'usb', name: 'USB devices', icon: '🔌', prompts: true },
  { id: 'serial', name: 'Serial devices', icon: '🔌', prompts: true },
  { id: 'hid', name: 'Game controllers (HID)', icon: '🕹️', prompts: true },
  { id: 'xr', name: 'VR / AR', icon: '🥽', prompts: true },
  { id: 'gamepad', name: 'Gamepad', icon: '🎮', prompts: false },
  { id: 'wake-lock', name: 'Keeps screen awake', icon: '☀️', prompts: false },
];

export const PERMISSION_IDS = new Set(PERMISSIONS.map((p) => p.id));

/** Source patterns per permission. Run on comment-stripped source, strings kept
 *  (event names like 'devicemotion' live in strings). */
const PATTERNS: Record<string, RegExp[]> = {
  motion: [
    /\bDeviceMotionEvent\b/,
    /\bDeviceOrientationEvent\b/,
    /['"`]device(?:motion|orientation)(?:absolute)?['"`]/,
    /\bondevice(?:motion|orientation)\b/,
    /\bnew\s+(?:Accelerometer|Gyroscope|Magnetometer|LinearAccelerationSensor|GravitySensor|AbsoluteOrientationSensor|RelativeOrientationSensor)\s*\(/,
  ],
  location: [/\bgeolocation\s*\.\s*(?:getCurrentPosition|watchPosition)\b/],
  notifications: [
    /\bNotification\s*\.\s*requestPermission\b/,
    /\bnew\s+Notification\s*\(/,
    /\bpushManager\s*\.\s*subscribe\b/,
    /\bshowNotification\s*\(/,
  ],
  midi: [/\brequestMIDIAccess\b/],
  'clipboard-read': [/\bclipboard\s*\.\s*read(?:Text)?\s*\(/],
  bluetooth: [/\bnavigator\s*\.\s*bluetooth\b/],
  usb: [/\bnavigator\s*\.\s*usb\b/],
  serial: [/\bnavigator\s*\.\s*serial\b/],
  hid: [/\bnavigator\s*\.\s*hid\b/],
  xr: [/\bnavigator\s*\.\s*xr\b/, /\brequestSession\s*\(\s*['"`]immersive-/],
  gamepad: [/\bgetGamepads\s*\(/, /['"`]gamepadconnected['"`]/, /\bongamepadconnected\b/],
  'wake-lock': [/\bwakeLock\s*\.\s*request\s*\(/],
};

const MEDIA_RE = /\bgetUserMedia\s*\(/;

/** Permissions the given source text uses. */
export function detectPermissionsInText(raw: string): Set<string> {
  const src = stripCommentsOnly(raw);
  const found = new Set<string>();
  for (const [id, patterns] of Object.entries(PATTERNS)) {
    if (patterns.some((re) => re.test(src))) found.add(id);
  }
  // getUserMedia can't say statically which device it wants unless the
  // constraints are visible. Count what's named; if neither is, list both so
  // the player is never surprised by a prompt.
  if (MEDIA_RE.test(src)) {
    const audio = /\baudio\s*:/.test(src);
    const video = /\bvideo\s*:/.test(src);
    if (audio || !video) found.add('microphone');
    if (video || !audio) found.add('camera');
  }
  return found;
}

const SCANNED = /^web\/(?:src\/.*\.(?:[cm]?[jt]sx?|vue|svelte|html)|index\.html)$/;

/** Permissions used anywhere in the game's own source, sorted by catalog order. */
export async function detectPermissions(source: FileSource): Promise<string[]> {
  const found = new Set<string>();
  for await (const path of source.list()) {
    if (!SCANNED.test(path)) continue;
    const text = await source.read(path);
    if (text) for (const id of detectPermissionsInText(text)) found.add(id);
  }
  return PERMISSIONS.map((p) => p.id).filter((id) => found.has(id));
}

export interface DeclaredPermissions {
  /** id → one-line reason ('' when none was given). Known ids only. */
  declared: Record<string, string>;
  /** Ids in the declaration that aren't in PERMISSIONS. */
  unknown: string[];
  /** Set when package.json exists but the declaration can't be read. */
  error?: string;
}

const REASON_MAX = 120;

/**
 * Reads `"freegamestore": { "permissions": … }` from the repo-root package.json.
 * Accepts an object (`{ "motion": "Tilt to steer" }`) or an array of ids or
 * `{ id, reason }` entries. Reasons are trimmed to one line of 120 chars.
 */
export function parseDeclaredPermissions(packageJson: string | null): DeclaredPermissions {
  const out: DeclaredPermissions = { declared: {}, unknown: [] };
  if (!packageJson) return out;
  let pkg: unknown;
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    return { ...out, error: 'package.json is not valid JSON' };
  }
  const raw = (pkg as { freegamestore?: { permissions?: unknown } } | null)?.freegamestore
    ?.permissions;
  if (raw === undefined) return out;
  const entries: Array<[string, unknown]> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') entries.push([item, '']);
      else if (
        item &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string'
      ) {
        entries.push([(item as { id: string }).id, (item as { reason?: unknown }).reason]);
      }
    }
  } else if (raw && typeof raw === 'object') {
    entries.push(...Object.entries(raw as Record<string, unknown>));
  } else {
    return { ...out, error: 'freegamestore.permissions must be an object or an array' };
  }
  for (const [id, reason] of entries) {
    const key = id.trim().toLowerCase();
    if (!PERMISSION_IDS.has(key)) {
      out.unknown.push(id);
      continue;
    }
    const line = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim() : '';
    out.declared[key] = line.slice(0, REASON_MAX);
  }
  return out;
}
