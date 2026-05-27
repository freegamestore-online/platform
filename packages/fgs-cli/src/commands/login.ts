import { Command } from 'commander';
import { readConfig, writeConfig } from '../lib/config.js';
import { startDeviceFlow } from '../lib/github.js';

// Public client_id for the shared GitHub OAuth App. Device-flow client_ids
// are not secret. Override at runtime via FGS_GITHUB_CLIENT_ID.
const DEFAULT_CLIENT_ID = process.env.FGS_GITHUB_CLIENT_ID ?? 'Ov23liuUpYPXc1ikEFm2';

export async function runLogin(): Promise<{ login: string }> {
  if (!DEFAULT_CLIENT_ID) {
    throw new Error(
      'GitHub client_id is not configured. The platform admin must register a GitHub OAuth App ' +
        'and set FGS_GITHUB_CLIENT_ID, or bake it into the published CLI build.',
    );
  }

  const flow = await startDeviceFlow(DEFAULT_CLIENT_ID);
  process.stdout.write(`\nOpen ${flow.verificationUri} and enter code: ${flow.userCode}\n\n`);
  process.stdout.write('Waiting for authorization...\n');

  const { accessToken, login } = await flow.poll();
  const config = await readConfig();

  const exchangeRes = await fetch(`${config.apiBase}/v1/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ githubToken: accessToken }),
  });
  if (!exchangeRes.ok) {
    throw new Error(`Auth exchange failed (${exchangeRes.status}): ${await exchangeRes.text()}`);
  }
  const { sessionToken } = (await exchangeRes.json()) as { sessionToken: string };

  await writeConfig({
    ...config,
    github: { accessToken, login, obtainedAt: Date.now() },
    session: { token: sessionToken, obtainedAt: Date.now() },
  });
  process.stdout.write(`\n✓ Signed in as @${login}\n`);
  return { login };
}

export const loginCommand = new Command('login')
  .description('Sign in with GitHub.')
  .action(async () => {
    await runLogin();
  });
