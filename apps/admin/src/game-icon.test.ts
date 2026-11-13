import { describe, expect, it } from 'vitest';
import { pickGameIcon } from './game-icon';

describe('pickGameIcon (#537)', () => {
  it('matches the name before the description', () => {
    expect(pickGameIcon('Snake Rush', 'A racing game', 'casual')).toBe('🐍');
  });

  it('falls back to the description, then to the category', () => {
    expect(pickGameIcon('Zenith', 'Sort the coloured tubes', 'casual')).toBe('🧩');
    expect(pickGameIcon('Zenith', 'Zenith', 'strategy')).toBe('♟️');
  });

  it('matches whole words only', () => {
    expect(pickGameIcon('Scarlet', 'Scarlet', 'casual')).toBe('🎈');
  });
});
