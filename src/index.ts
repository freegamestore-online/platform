/** FGS platform workspace packages */
export const PACKAGES = ['games-sdk', 'fgs-cli', 'compliance'] as const;
export type Package = (typeof PACKAGES)[number];
