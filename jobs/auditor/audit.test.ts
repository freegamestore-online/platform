import { describe, expect, it } from 'vitest';
import { computeIndex, REFERENCE } from './audit.ts';

// ---------------------------------------------------------------------------
// Unit tests for the scoring algorithm
// ---------------------------------------------------------------------------

describe('computeIndex', () => {
  const allIds = REFERENCE.map((r) => r.id);
  const portraitIds = REFERENCE.filter((r) => r.orientation === 'portrait').map((r) => r.id);
  const landscapeIds = REFERENCE.filter((r) => r.orientation === 'landscape').map((r) => r.id);

  it('returns 99 when all viewports pass', () => {
    const passing = new Set(allIds);
    expect(computeIndex(passing)).toBe(99);
  });

  it('returns 0 when no viewports pass', () => {
    const passing = new Set<string>();
    expect(computeIndex(passing)).toBe(0);
  });

  it('returns 0 when only portrait viewports pass (landscape scores 0)', () => {
    const passing = new Set(portraitIds);
    // Portrait max is 99 but landscape max is 0 -> min(99, 0) = 0
    expect(computeIndex(passing)).toBe(0);
  });

  it('returns 0 when only landscape viewports pass (portrait scores 0)', () => {
    const passing = new Set(landscapeIds);
    // Landscape max is 99 but portrait max is 0 -> min(0, 99) = 0
    expect(computeIndex(passing)).toBe(0);
  });

  it('returns min of portrait and landscape scores', () => {
    // Pass the highest portrait (p-320, share=99) and a mid landscape (l-1024, share=35)
    const passing = new Set(['p-320', 'l-1024']);
    expect(computeIndex(passing)).toBe(35);
  });

  it('takes highest share per orientation', () => {
    // Pass two portrait viewports with different shares
    const passing = new Set(['p-1024', 'p-320', 'l-568']);
    // Portrait: max(20, 99) = 99, Landscape: 99 -> min(99, 99) = 99
    expect(computeIndex(passing)).toBe(99);
  });

  it('returns 20 when only iPad Pro viewports pass (both orientations)', () => {
    const passing = new Set(['p-1024', 'l-1366']);
    // Portrait: 20, Landscape: 20 -> min(20, 20) = 20
    expect(computeIndex(passing)).toBe(20);
  });

  it('handles single viewport per orientation', () => {
    const passing = new Set(['p-414', 'l-667']);
    // Portrait: 88, Landscape: 96 -> min(88, 96) = 88
    expect(computeIndex(passing)).toBe(88);
  });
});
