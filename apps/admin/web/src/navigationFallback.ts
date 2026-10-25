/** Navigation paths that must reach the admin worker instead of the cached SPA. */
export const adminNavigationFallbackDenylist = [
  /^\/auth(?:\/|$)/,
  /^\/api(?:\/|$)/,
  /^\/v1(?:\/|$)/,
  /^\/docs(?:\/|$)/,
];

export function usesAdminSpaNavigationFallback(pathname: string): boolean {
  return !adminNavigationFallbackDenylist.some((pattern) => pattern.test(pathname));
}
