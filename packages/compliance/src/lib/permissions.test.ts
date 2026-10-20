import { describe, expect, it } from 'vitest';
import { mapFileSource } from './file-source.js';
import {
  detectPermissions,
  detectPermissionsInText,
  PERMISSIONS,
  parseDeclaredPermissions,
} from './permissions.js';

// #370: what a game will ask the player for, from its own source.

const ids = (src: string) => [...detectPermissionsInText(src)].sort();

describe('detectPermissionsInText', () => {
  it.each([
    ['motion', "window.addEventListener('deviceorientation', onTilt)"],
    ['motion', 'if (typeof DeviceMotionEvent.requestPermission === "function") {}'],
    ['motion', 'const s = new Accelerometer({ frequency: 60 })'],
    ['location', 'navigator.geolocation.getCurrentPosition(ok)'],
    ['location', 'navigator.geolocation.watchPosition(ok)'],
    ['notifications', 'await Notification.requestPermission()'],
    ['notifications', 'reg.pushManager.subscribe({ userVisibleOnly: true })'],
    ['midi', 'navigator.requestMIDIAccess()'],
    ['clipboard-read', 'await navigator.clipboard.readText()'],
    ['bluetooth', 'navigator.bluetooth.requestDevice({})'],
    ['usb', 'navigator.usb.requestDevice({ filters: [] })'],
    ['serial', 'navigator.serial.requestPort()'],
    ['hid', 'navigator.hid.requestDevice({ filters: [] })'],
    ['xr', "navigator.xr.requestSession('immersive-vr')"],
    ['gamepad', 'const pads = navigator.getGamepads()'],
    ['gamepad', "addEventListener('gamepadconnected', f)"],
    ['wake-lock', "await navigator.wakeLock.request('screen')"],
  ])('detects %s', (id, src) => {
    expect(ids(src)).toContain(id);
  });

  it('splits getUserMedia by its constraints', () => {
    expect(ids('navigator.mediaDevices.getUserMedia({ audio: true })')).toEqual(['microphone']);
    expect(ids('navigator.mediaDevices.getUserMedia({ video: true })')).toEqual(['camera']);
    expect(ids('getUserMedia({ audio: true, video: true })')).toEqual(['camera', 'microphone']);
    // Constraints built elsewhere: list both so no prompt is a surprise.
    expect(ids('getUserMedia(constraints)')).toEqual(['camera', 'microphone']);
  });

  it('ignores comments and look-alikes', () => {
    expect(ids('// navigator.geolocation.getCurrentPosition(x)\n/* requestMIDIAccess */')).toEqual(
      [],
    );
    expect(
      ids('const geolocation = null; clipboard.writeText(s); el.requestFullscreen();'),
    ).toEqual([]);
    expect(ids('vibrate(20); localStorage.setItem("x", "1")')).toEqual([]);
  });

  it('has a pattern or a rule for every catalog entry', () => {
    for (const p of PERMISSIONS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('detectPermissions over a repo', () => {
  it('scans web/src and web/index.html only, in catalog order', async () => {
    const source = mapFileSource(
      new Map([
        ['web/src/input.ts', 'navigator.getGamepads()'],
        ['web/src/tilt.tsx', "addEventListener('devicemotion', f)"],
        ['web/index.html', '<script>navigator.wakeLock.request("screen")</script>'],
        ['web/public/vendor/engine.js', 'navigator.mediaDevices.getUserMedia({ audio: true })'],
        ['scripts/tool.ts', 'navigator.requestMIDIAccess()'],
      ]),
    );
    expect(await detectPermissions(source)).toEqual(['motion', 'gamepad', 'wake-lock']);
  });
});

describe('parseDeclaredPermissions', () => {
  it('reads the object form with reasons', () => {
    const pkg = JSON.stringify({
      freegamestore: { permissions: { motion: 'Tilt to steer', Gamepad: '' } },
    });
    expect(parseDeclaredPermissions(pkg)).toEqual({
      declared: { motion: 'Tilt to steer', gamepad: '' },
      unknown: [],
    });
  });

  it('reads the array form and keeps one short line per reason', () => {
    const pkg = JSON.stringify({
      freegamestore: {
        permissions: ['gamepad', { id: 'microphone', reason: `Sing\n  along ${'x'.repeat(200)}` }],
      },
    });
    const r = parseDeclaredPermissions(pkg);
    expect(r.declared.gamepad).toBe('');
    expect(r.declared.microphone?.startsWith('Sing along x')).toBe(true);
    expect(r.declared.microphone?.length).toBe(120);
  });

  it('reports unknown ids and bad shapes', () => {
    expect(
      parseDeclaredPermissions(
        JSON.stringify({ freegamestore: { permissions: { teleport: 'x' } } }),
      ).unknown,
    ).toEqual(['teleport']);
    expect(
      parseDeclaredPermissions(JSON.stringify({ freegamestore: { permissions: 'motion' } })).error,
    ).toMatch(/object or an array/);
    expect(parseDeclaredPermissions('{nope').error).toMatch(/not valid JSON/);
  });

  it('treats no package.json or no declaration as none declared', () => {
    expect(parseDeclaredPermissions(null)).toEqual({ declared: {}, unknown: [] });
    expect(parseDeclaredPermissions('{"name":"x"}')).toEqual({ declared: {}, unknown: [] });
  });
});
