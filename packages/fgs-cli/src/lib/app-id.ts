/**
 * Validates an app id. The same shape is enforced by the publisher portal
 * and used for DNS subdomains, CF Pages project naming, and repo names.
 *
 * Rules: lowercase letter first, then 1-30 of [a-z0-9-]. Total length 2-31.
 */
const APP_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

export function isValidAppId(s: string): boolean {
  return APP_ID_RE.test(s);
}

export function assertValidAppId(s: string): void {
  if (!isValidAppId(s)) {
    throw new Error(
      'app-id must start with a lowercase letter and contain only lowercase letters, digits, or hyphens (2-31 chars).',
    );
  }
}
