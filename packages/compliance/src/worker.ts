/**
 * Worker-safe entry point (`@freegamestore/compliance/worker`).
 *
 * Same checks as the default entry, minus the two node:fs front doors
 * (`fsFileSource`, `runChecks`). The VibeCode agent runs in a Cloudflare
 * Worker and holds its virtual filesystem as a Map, so it imports from
 * here and calls `runChecksFromFiles(map)` — nothing in this module's
 * import graph touches node:fs, so it bundles cleanly for Workers.
 */

export { checkAudioMuteRespect } from './checks/audio-mute-respect.js';
export { checkBrandFonts } from './checks/brand-fonts.js';
export { checkBrandTokens } from './checks/brand-tokens.js';
export { checkBundleSize } from './checks/bundle-size.js';
export { checkClaudeMdSlim } from './checks/claude-md-slim.js';
export { checkDarkMode } from './checks/dark-mode.js';
export { checkDeployWorkflow } from './checks/deploy-workflow.js';
export { checkGameNaming } from './checks/game-naming.js';
export { checkGitignoreComplete } from './checks/gitignore-complete.js';
export { checkHtmlMeta } from './checks/html-meta.js';
export { checkLicenseMit } from './checks/license-mit.js';
export { checkManifest } from './checks/manifest.js';
export { checkNoAnyTypes } from './checks/no-any-types.js';
export { checkNoBrandOverrides } from './checks/no-brand-overrides.js';
export { checkNoConsoleLog } from './checks/no-console-log.js';
export { checkNoCookies } from './checks/no-cookies.js';
export { checkNoEnvProduction } from './checks/no-env-production.js';
export { checkNoExcessiveInlineStyles } from './checks/no-excessive-inline-styles.js';
export { checkNoExternalFetch } from './checks/no-external-fetch.js';
export { checkNoExternalScripts } from './checks/no-external-scripts.js';
export { checkNoHardcodedColors } from './checks/no-hardcoded-colors.js';
export { checkNoPagePolicy } from './checks/no-page-policy.js';
export { checkNoPaymentCapabilities } from './checks/no-payment-capabilities.js';
export { checkNoPaymentSdk } from './checks/no-payment-sdk.js';
export { checkNoPlaceholders } from './checks/no-placeholders.js';
export { checkNoScroll } from './checks/no-scroll.js';
export { checkNoTracking } from './checks/no-tracking.js';
export { checkPermissionsDeclared } from './checks/permissions-declared.js';
export { checkPwaIcons } from './checks/pwa-icons.js';
export { checkMaskableIcon } from './checks/pwa-maskable-icon.js';
export { checkPwaMeta } from './checks/pwa-meta.js';
export { checkPwaOffline } from './checks/pwa-offline.js';
export { checkReactStrictMode } from './checks/react-strict-mode.js';
export { checkSdkVersion } from './checks/sdk-version.js';
export { checkStoreLink } from './checks/store-link.js';
export { checkTechVersions } from './checks/tech-versions.js';
export { checkTypescriptStrict } from './checks/typescript-strict.js';
export { checkUnsafeVh } from './checks/unsafe-vh.js';
export { checkUsesGameSdk } from './checks/uses-game-sdk.js';
export { checkUsesLocalStorage } from './checks/uses-localstorage.js';
export { checkViewportSupport } from './checks/viewport-support.js';
export { GAME_CI_WORKFLOW, GAME_DEPLOY_WORKFLOW } from './game-deploy-workflow.js';
export { type FileSource, mapFileSource } from './lib/file-source.js';
export {
  detectPermissions,
  PERMISSIONS,
  parseDeclaredPermissions,
} from './lib/permissions.js';
export { isGameProject } from './lib/project-type.js';
export type { LiveAuditInput, LiveAuditReport } from './live/index.js';
export {
  auditLive,
  checkBrandFontsLive,
  checkBundleSizeLive,
  checkManifestLive,
  checkNoTrackingLive,
  checkUnsafeVhLive,
} from './live/index.js';
export { runChecksFromFiles, runChecksOn } from './run-checks.js';
export type { CheckResult, CheckStatus } from './types.js';
