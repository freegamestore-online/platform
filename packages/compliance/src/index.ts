import { checkAudioMuteRespect } from './checks/audio-mute-respect.js';
import { checkBrandFonts } from './checks/brand-fonts.js';
import { checkBrandTokens } from './checks/brand-tokens.js';
import { checkBundleSize } from './checks/bundle-size.js';
import { checkClaudeMdSlim } from './checks/claude-md-slim.js';
import { checkDarkMode } from './checks/dark-mode.js';
import { checkDeployWorkflow } from './checks/deploy-workflow.js';
import { checkGameNaming } from './checks/game-naming.js';
import { checkGitignoreComplete } from './checks/gitignore-complete.js';
import { checkHtmlMeta } from './checks/html-meta.js';
import { checkLicenseMit } from './checks/license-mit.js';
import { checkManifest } from './checks/manifest.js';
import { checkNoAnyTypes } from './checks/no-any-types.js';
import { checkNoBrandOverrides } from './checks/no-brand-overrides.js';
import { checkNoConsoleLog } from './checks/no-console-log.js';
import { checkNoCookies } from './checks/no-cookies.js';
import { checkNoEnvProduction } from './checks/no-env-production.js';
import { checkNoExcessiveInlineStyles } from './checks/no-excessive-inline-styles.js';
import { checkNoExternalFetch } from './checks/no-external-fetch.js';
import { checkNoExternalScripts } from './checks/no-external-scripts.js';
import { checkNoHardcodedColors } from './checks/no-hardcoded-colors.js';
import { checkNoPaymentSdk } from './checks/no-payment-sdk.js';
import { checkNoPlaceholders } from './checks/no-placeholders.js';
import { checkNoScroll } from './checks/no-scroll.js';
import { checkNoTracking } from './checks/no-tracking.js';
import { checkPwaIcons } from './checks/pwa-icons.js';
import { checkMaskableIcon } from './checks/pwa-maskable-icon.js';
import { checkPwaMeta } from './checks/pwa-meta.js';
import { checkPwaOffline } from './checks/pwa-offline.js';
import { checkReactStrictMode } from './checks/react-strict-mode.js';
import { checkSdkVersion } from './checks/sdk-version.js';
import { checkStoreLink } from './checks/store-link.js';
import { checkTechVersions } from './checks/tech-versions.js';
import { checkTypescriptStrict } from './checks/typescript-strict.js';
import { checkUnsafeVh } from './checks/unsafe-vh.js';
import { checkUsesGameSdk } from './checks/uses-game-sdk.js';
import { checkUsesLocalStorage } from './checks/uses-localstorage.js';
import { checkViewportSupport } from './checks/viewport-support.js';
import { mapFileSource } from './lib/file-source.js';
import { fsFileSource } from './lib/fs-file-source.js';
import { isGameProject } from './lib/project-type.js';
import { runChecksFromFiles, runChecksOn } from './run-checks.js';
import type { CheckResult } from './types.js';

export type { FileSource } from './lib/file-source.js';
export type { LiveAuditInput, LiveAuditReport } from './live/index.js';
// Live-URL audit (used by the compliance audit Worker; runs in
// browser/Workers env, no filesystem). Separate export path so callers
// don't accidentally pull node:fs in via the file-walking checks.
export {
  auditLive,
  checkBrandFontsLive,
  checkBundleSizeLive,
  checkManifestLive,
  checkNoTrackingLive,
  checkUnsafeVhLive,
} from './live/index.js';
export type { CheckResult, CheckStatus } from './types.js';
// Check battery + the Map front door live in run-checks.ts (node-free,
// also re-exported from ./worker for Workers). Re-exported here so
// existing CLI/back-end importers keep their single import site.
export {
  checkAudioMuteRespect,
  checkBrandFonts,
  checkBrandTokens,
  checkBundleSize,
  checkClaudeMdSlim,
  checkDarkMode,
  checkDeployWorkflow,
  checkGameNaming,
  checkGitignoreComplete,
  checkHtmlMeta,
  checkLicenseMit,
  checkManifest,
  checkMaskableIcon,
  checkNoAnyTypes,
  checkNoBrandOverrides,
  checkNoConsoleLog,
  checkNoCookies,
  checkNoEnvProduction,
  checkNoExcessiveInlineStyles,
  checkNoExternalFetch,
  checkNoExternalScripts,
  checkNoHardcodedColors,
  checkNoPaymentSdk,
  checkNoPlaceholders,
  checkNoScroll,
  checkNoTracking,
  checkPwaIcons,
  checkPwaMeta,
  checkPwaOffline,
  checkReactStrictMode,
  checkSdkVersion,
  checkStoreLink,
  checkTechVersions,
  checkTypescriptStrict,
  checkUnsafeVh,
  checkUsesGameSdk,
  checkUsesLocalStorage,
  checkViewportSupport,
  fsFileSource,
  isGameProject,
  mapFileSource,
  runChecksFromFiles,
  runChecksOn,
};

/**
 * On-disk front door — CLI / CI. Reads from a real directory via
 * fsFileSource (node:fs). The Map front door (`runChecksFromFiles`)
 * shares the same check battery through the FileSource abstraction, so
 * rules stay in one place regardless of where the files come from.
 */
export async function runChecks(repoDir: string): Promise<CheckResult[]> {
  return runChecksOn(fsFileSource(repoDir));
}
