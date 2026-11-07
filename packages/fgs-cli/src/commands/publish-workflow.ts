import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GAME_DEPLOY_WORKFLOW } from '@freegamestore/compliance';

export type DeployWorkflowChange = 'added' | 'replaced' | 'unchanged';

/** Make `.github/workflows/deploy.yml` exactly the supported keyless caller
 *  (#523). A missing file is added; any other content (a legacy inline-R2 or
 *  `secrets: inherit` workflow from an old `fgs init` checkout) is replaced,
 *  because the creator force-pushes this checkout over the generated repo. The
 *  content is the one the agent also ships (#111), from @freegamestore/compliance. */
export async function ensureDeployWorkflow(): Promise<DeployWorkflowChange> {
  const target = join(process.cwd(), '.github', 'workflows', 'deploy.yml');
  let existing: string | null = null;
  try {
    existing = await readFile(target, 'utf8');
  } catch {
    // missing: add it below
  }
  if (existing === GAME_DEPLOY_WORKFLOW) return 'unchanged';
  await mkdir(join(process.cwd(), '.github', 'workflows'), { recursive: true });
  await writeFile(target, GAME_DEPLOY_WORKFLOW);
  return existing === null ? 'added' : 'replaced';
}
