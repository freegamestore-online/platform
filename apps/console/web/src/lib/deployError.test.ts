import { describe, expect, it } from 'vitest';
import type { DeployState } from '../types';
import { deployErrorInfo, RETRY_DEPLOY_PROMPT } from './deployError';

const errored = (error?: string): DeployState => ({ phase: 'error', error });

describe('deployErrorInfo', () => {
  it('passes a real error through untouched', () => {
    const info = deployErrorInfo(errored('vite build failed: duplicate declaration'), 'my-game');
    expect(info.message).toBe('vite build failed: duplicate declaration');
    expect(info.hasDetail).toBe(true);
  });

  it("links the game's Actions tab when the id is known", () => {
    expect(deployErrorInfo(errored('boom'), 'my-game').actionsUrl).toBe(
      'https://github.com/freegamestore-online/my-game/actions',
    );
  });

  it('has no Actions link before the game has an id', () => {
    expect(deployErrorInfo(errored('boom'), undefined).actionsUrl).toBeNull();
  });

  // AC4: "Deploy failed" alone leaves the creator with nowhere to go. The server's
  // error event really can carry an empty string.
  it('falls back to an actionable message when the error is empty', () => {
    const info = deployErrorInfo(errored(''), 'my-game');
    expect(info.hasDetail).toBe(false);
    expect(info.message).not.toBe('Deploy failed');
    expect(info.message).toContain('Actions tab');
  });

  it('treats a whitespace-only error as no detail', () => {
    expect(deployErrorInfo(errored('   \n  '), 'my-game').hasDetail).toBe(false);
  });

  it('falls back when the error field is missing entirely', () => {
    expect(deployErrorInfo(errored(undefined), 'my-game').hasDetail).toBe(false);
  });

  it('points at GitHub Actions generically when there is no game id', () => {
    const info = deployErrorInfo(errored(''), null);
    expect(info.message).toContain('GitHub Actions');
    expect(info.actionsUrl).toBeNull();
  });

  it('handles a null state', () => {
    expect(deployErrorInfo(null, 'my-game').hasDetail).toBe(false);
  });

  // A bare re-deploy of unchanged code fails CI identically — the prompt must
  // send the agent to the logs first.
  it('retry prompt asks the agent to diagnose before redeploying', () => {
    expect(RETRY_DEPLOY_PROMPT).toContain('build logs');
    expect(RETRY_DEPLOY_PROMPT).toContain('fix');
    expect(RETRY_DEPLOY_PROMPT).toContain('deploy again');
  });
});
