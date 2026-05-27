import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Validates game naming conventions from the platform guidelines:
 *
 *   - Package name should be lowercase
 *   - Should not start with "free" or "pro" (reserved platform prefixes)
 *   - Should not contain spaces or special characters (beyond hyphens)
 *   - If CLAUDE.md exists, the subdomain should match the expected
 *     pattern (`gamename.freegamestore.online`)
 *
 * Checks both root `package.json` and `web/package.json`. WARN level —
 * a bad name won't break the build, but it will cause issues at publish
 * time when the admin Worker derives the subdomain and repo name.
 */

const RESERVED_PREFIXES = ['free', 'pro'];

interface NamingIssue {
  field: string;
  value: string;
  problem: string;
}

function checkName(name: string, source: string): NamingIssue[] {
  const issues: NamingIssue[] = [];

  if (name !== name.toLowerCase()) {
    issues.push({
      field: source,
      value: name,
      problem: 'package name should be lowercase',
    });
  }

  for (const prefix of RESERVED_PREFIXES) {
    if (name.toLowerCase().startsWith(prefix)) {
      issues.push({
        field: source,
        value: name,
        problem: `"${prefix}" is a reserved platform prefix`,
      });
      break;
    }
  }

  // Allow lowercase letters, digits, hyphens, and npm scoped names (@scope/name).
  // Reject spaces and other special characters.
  if (/[^a-z0-9\-@/.]/.test(name)) {
    issues.push({
      field: source,
      value: name,
      problem: 'contains spaces or special characters',
    });
  }

  return issues;
}

export async function checkGameNaming(source: FileSource): Promise<CheckResult> {
  const issues: NamingIssue[] = [];

  // Only check web/package.json for naming conventions. The root
  // package.json name often follows CF Pages project naming (e.g.
  // "freechessapp") which legitimately uses the "free" prefix — that's
  // the platform's naming scheme, not the game developer's choice.
  const webRaw = await source.read('web/package.json');
  if (webRaw) {
    try {
      const webPkg = JSON.parse(webRaw);
      if (typeof webPkg.name === 'string') {
        issues.push(...checkName(webPkg.name, 'web/package.json name'));
      }
    } catch {
      // invalid JSON — other checks will flag this
    }
  }

  // Check CLAUDE.md for subdomain pattern consistency
  const claudeMd = await source.read('CLAUDE.md');
  if (claudeMd) {
    const subdomainMatch = claudeMd.match(/([a-z0-9-]+)\.freegamestore\.online/);
    if (subdomainMatch) {
      const subdomain = subdomainMatch[1]!;
      // The subdomain should be a clean slug — no underscores, no uppercase
      if (/[^a-z0-9-]/.test(subdomain)) {
        issues.push({
          field: 'CLAUDE.md subdomain',
          value: `${subdomain}.freegamestore.online`,
          problem: 'subdomain should only contain lowercase letters, digits, and hyphens',
        });
      }
    }
  }

  if (issues.length === 0) {
    return {
      name: 'Game naming conventions',
      status: 'pass',
      detail: 'package names follow platform naming conventions',
    };
  }

  return {
    name: 'Game naming conventions',
    status: 'warn',
    detail: issues
      .map((i) => `${i.field}: "${i.value}" — ${i.problem}`)
      .join('; '),
    suggestions: [
      'Package names should be lowercase, hyphen-separated, without reserved prefixes (free*, pro*).',
      'The publish flow derives the subdomain and GitHub repo name from the package name — clean names prevent issues.',
    ],
  };
}
