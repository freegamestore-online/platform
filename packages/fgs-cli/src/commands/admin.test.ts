import { describe, expect, it } from 'vitest';
import { adminCommand, adminToken, formatTransferFailure } from './admin.js';

describe('adminToken', () => {
  it('reads FGS_ADMIN_TOKEN and trims it', () => {
    expect(adminToken({ FGS_ADMIN_TOKEN: '  abc.def.ghi \n' })).toBe('abc.def.ghi');
  });

  it('is null when unset or blank', () => {
    expect(adminToken({})).toBeNull();
    expect(adminToken({ FGS_ADMIN_TOKEN: '  ' })).toBeNull();
  });
});

describe('formatTransferFailure', () => {
  it('includes the current owner on a compare-and-set refusal', () => {
    const msg = formatTransferFailure(
      409,
      JSON.stringify({ error: 'owner mismatch', owner_login: 'carol' }),
    );
    expect(msg).toBe('transfer-owner failed (409): owner mismatch (current owner is carol)');
  });

  it('says so when the game has no recorded owner', () => {
    const msg = formatTransferFailure(
      409,
      JSON.stringify({ error: 'owner mismatch', owner_login: null }),
    );
    expect(msg).toBe('transfer-owner failed (409): owner mismatch (current owner is not recorded)');
  });

  it('names an unknown login', () => {
    expect(
      formatTransferFailure(400, JSON.stringify({ error: 'unknown login', login: 'nope' })),
    ).toBe('transfer-owner failed (400): unknown login: nope');
  });

  it('keeps a non-JSON body as-is', () => {
    expect(formatTransferFailure(502, 'bad gateway')).toBe(
      'transfer-owner failed (502): bad gateway',
    );
  });
});

describe('fgs admin transfer-owner', () => {
  const cmd = adminCommand.commands.find((c) => c.name() === 'transfer-owner');

  it('is registered with the compare-and-set flags', () => {
    expect(cmd).toBeDefined();
    expect(cmd!.registeredArguments.map((arg) => arg.name())).toEqual(['game']);
    const flags = cmd!.options.map((option) => option.long);
    expect(flags).toEqual(expect.arrayContaining(['--from', '--to', '--reason', '--json']));
    for (const name of ['--from', '--to', '--reason']) {
      expect(cmd!.options.find((option) => option.long === name)?.required).toBe(true);
    }
  });

  it('has a transfers listing command', () => {
    expect(adminCommand.commands.map((c) => c.name())).toContain('transfers');
  });
});
