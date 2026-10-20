import type { FileSource } from '../lib/file-source.js';
import { detectPermissions, PERMISSIONS, parseDeclaredPermissions } from '../lib/permissions.js';
import type { CheckResult } from '../types.js';

const NAME = 'Permissions declared';

/**
 * Every browser permission the game's code uses should be declared, with a
 * one-line reason, in package.json under `freegamestore.permissions` (#370).
 * The storefront shows them on the listing so the browser's prompt is no
 * surprise to the player.
 *
 * WARN level: the listing shows detected permissions even when undeclared, so
 * nothing is hidden from players; declaring adds the reason.
 */
export async function checkPermissionsDeclared(source: FileSource): Promise<CheckResult> {
  const detected = await detectPermissions(source);
  const { declared, unknown, error } = parseDeclaredPermissions(await source.read('package.json'));
  if (error) {
    return { name: NAME, status: 'warn', detail: error, suggestions: [example()] };
  }
  const undeclared = detected.filter((id) => !(id in declared));
  const problems: string[] = [];
  if (undeclared.length) problems.push(`used but not declared: ${undeclared.join(', ')}`);
  if (unknown.length) problems.push(`unknown permission id(s): ${unknown.join(', ')}`);
  if (problems.length) {
    return {
      name: NAME,
      status: 'warn',
      detail: problems.join('; '),
      suggestions: [example(undeclared), `Known ids: ${PERMISSIONS.map((p) => p.id).join(', ')}.`],
    };
  }
  const all = Object.keys(declared);
  return {
    name: NAME,
    status: 'pass',
    detail: all.length ? `declared: ${all.join(', ')}` : 'no special permissions used',
  };
}

function example(ids: string[] = ['motion']): string {
  const body = ids.map((id) => `"${id}": "<why the game needs it>"`).join(', ');
  return `Declare them in package.json: "freegamestore": { "permissions": { ${body} } }`;
}
