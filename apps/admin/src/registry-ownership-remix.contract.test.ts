import attributionCases from '../../../contracts/registry-ownership-remix/v1/attribution-cases.json';
import idCases from '../../../contracts/registry-ownership-remix/v1/id-cases.json';
import ownershipCases from '../../../contracts/registry-ownership-remix/v1/ownership-cases.json';
import registryCases from '../../../contracts/registry-ownership-remix/v1/registry-cases.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeForkedFrom, ownershipFacts, validateId } from './publish';
import { readRegistry } from './registryReader';

const originalFetch = globalThis.fetch;
afterEach(() => vi.restoreAllMocks());

describe('registry-ownership-remix contract v1', () => {
  it('accepts canonical IDs only', () => {
    for (const testCase of idCases.cases)
      expect(validateId(testCase.id) === null, testCase.id).toBe(testCase.valid);
  });

  it('preserves registry availability states', async () => {
    for (const testCase of registryCases.cases) {
      vi.stubGlobal('fetch', async (input: unknown) => {
        const state = String(input).includes('raw.githubusercontent') ? testCase.raw : testCase.contents;
        if (state === 'success') return new Response(JSON.stringify({ games: [] }));
        if (state === 'missing') return new Response('', { status: 404 });
        if (state === 'malformed') return new Response(JSON.stringify({ nope: [] }));
        throw new TypeError('upstream unavailable');
      });
      expect((await readRegistry('token')).status, testCase.name).toBe(testCase.expected);
      vi.unstubAllGlobals();
      globalThis.fetch = originalFetch;
    }
  });

  it('evaluates ownership as facts', () => {
    for (const testCase of ownershipCases.cases) {
      expect(
        ownershipFacts(
          testCase.creatorGithub ? { creatorGithub: testCase.creatorGithub } : {},
          testCase.login,
          {
            isOrgMember: testCase.isOrgMember,
            isLegacyAcceptedCollaborator: testCase.isLegacyAcceptedCollaborator,
          },
        ),
        testCase.name,
      ).toEqual(testCase.expected);
    }
  });

  it('normalizes attribution conservatively', () => {
    for (const testCase of attributionCases.cases) {
      const result = normalizeForkedFrom(testCase.value, testCase.registry, testCase.legacyForkedAt);
      expect(
        result === undefined ? 'absent' : typeof result === 'string' ? 'legacy' : 'rich',
        testCase.name,
      ).toBe(testCase.expected);
    }
  });
});
