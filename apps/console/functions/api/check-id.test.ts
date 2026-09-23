import { describe, expect, it } from 'vitest';
import { validateId } from './check-id';

// validateId guards which game ids may be provisioned. It must agree with the
// same grammar in create.ts. These lock the rules down.
describe('check-id validateId', () => {
  it('requires a non-empty id', () => {
    expect(validateId('')).toBeTruthy();
  });

  it('rejects reserved / infrastructure ids', () => {
    for (const id of ['submissions', 'brand', 'ops', 'sdk', 'template-game-canvas']) {
      expect(validateId(id)).toBe('Reserved id');
    }
  });

  it("bans the 'free' and 'pro' prefixes", () => {
    expect(validateId('freefoo')).toBe("Cannot start with 'free' or 'pro'");
    expect(validateId('progame')).toBe("Cannot start with 'free' or 'pro'");
  });

  it('rejects uppercase, spaces, and leading/trailing dashes', () => {
    expect(validateId('MyGame')).toBeTruthy();
    expect(validateId('my game')).toBeTruthy();
    expect(validateId('-game')).toBeTruthy();
    expect(validateId('game-')).toBeTruthy();
    expect(validateId('game_name')).toBeTruthy();
  });

  it('caps id length at 58 characters', () => {
    expect(validateId('a'.repeat(59))).toBe('58 characters max');
    // 58 chars, valid grammar, not reserved → accepted.
    expect(validateId('a'.repeat(58))).toBeNull();
  });

  it('accepts a well-formed id', () => {
    expect(validateId('coolgame')).toBeNull();
    expect(validateId('my-cool-game2')).toBeNull();
    expect(validateId('g')).toBeNull();
  });
});
