import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GAME_DEPLOY_WORKFLOW } from '@freegamestore/compliance';

/** Add the standard game deploy workflow if the repo has none. The content is
 *  the one the agent also ships (#111), from @freegamestore/compliance. */
export async function ensureDeployWorkflow(): Promise<boolean> {
  const target = join(process.cwd(), '.github', 'workflows', 'deploy.yml');
  try {
    await access(target);
    return false;
  } catch {
    await mkdir(join(process.cwd(), '.github', 'workflows'), { recursive: true });
    await writeFile(target, GAME_DEPLOY_WORKFLOW);
    return true;
  }
}
