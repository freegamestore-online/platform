import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkPermissionsDeclared } from './permissions-declared.js';

// #370: warn when the code uses a permission the game doesn't declare.

const repo = (files: Record<string, string>) => mapFileSource(new Map(Object.entries(files)));
const pkg = (permissions: unknown) => JSON.stringify({ name: 'g', freegamestore: { permissions } });

describe('checkPermissionsDeclared (#370)', () => {
  it('passes a game that uses nothing special', async () => {
    const r = await checkPermissionsDeclared(repo({ 'web/src/App.tsx': 'export const x = 1' }));
    expect(r).toMatchObject({ status: 'pass', detail: 'no special permissions used' });
  });

  it('passes when every used permission is declared', async () => {
    const r = await checkPermissionsDeclared(
      repo({
        'web/src/App.tsx': "addEventListener('deviceorientation', f)",
        'package.json': pkg({ motion: 'Tilt to steer' }),
      }),
    );
    expect(r).toMatchObject({ status: 'pass', detail: 'declared: motion' });
  });

  it('warns on a used but undeclared permission, with a ready-made declaration', async () => {
    const r = await checkPermissionsDeclared(
      repo({
        'web/src/App.tsx':
          'navigator.mediaDevices.getUserMedia({ audio: true }); navigator.getGamepads()',
        'package.json': pkg({ gamepad: '' }),
      }),
    );
    expect(r.status).toBe('warn');
    expect(r.detail).toBe('used but not declared: microphone');
    expect(r.suggestions?.[0]).toContain('"microphone": "<why the game needs it>"');
  });

  it('warns on an unknown id', async () => {
    const r = await checkPermissionsDeclared(
      repo({ 'web/src/App.tsx': '', 'package.json': pkg({ teleport: 'x' }) }),
    );
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('unknown permission id(s): teleport');
  });

  it('never fails a game', async () => {
    const r = await checkPermissionsDeclared(
      repo({ 'web/src/App.tsx': 'navigator.requestMIDIAccess()', 'package.json': '{bad' }),
    );
    expect(r.status).toBe('warn');
  });
});
