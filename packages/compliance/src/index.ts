import { checkAudioMuteRespect } from './checks/audio-mute-respect.js';
import { checkBrandFonts } from './checks/brand-fonts.js';
import { checkBrandTokens } from './checks/brand-tokens.js';
import { checkBundleSize } from './checks/bundle-size.js';
import { checkClaudeMdSlim } from './checks/claude-md-slim.js';
import { checkDarkMode } from './checks/dark-mode.js';
import { checkGameNaming } from './checks/game-naming.js';
import { checkHtmlMeta } from './checks/html-meta.js';
import { checkLicenseMit } from './checks/license-mit.js';
import { checkManifest } from './checks/manifest.js';
import { checkMaskableIcon } from './checks/pwa-maskable-icon.js';
import { checkNoAnyTypes } from './checks/no-any-types.js';
import { checkNoBrandOverrides } from './checks/no-brand-overrides.js';
import { checkNoConsoleLog } from './checks/no-console-log.js';
import { checkNoCookies } from './checks/no-cookies.js';
import { checkNoEnvProduction } from './checks/no-env-production.js';
import { checkNoExternalScripts } from './checks/no-external-scripts.js';
import { checkNoPaymentSdk } from './checks/no-payment-sdk.js';
import { checkNoPlaceholders } from './checks/no-placeholders.js';
import { checkNoScroll } from './checks/no-scroll.js';
import { checkNoTracking } from './checks/no-tracking.js';
import { checkPwaIcons } from './checks/pwa-icons.js';
import { checkPwaMeta } from './checks/pwa-meta.js';
import { checkPwaOffline } from './checks/pwa-offline.js';
import { checkSdkVersion } from './checks/sdk-version.js';
import { checkStoreLink } from './checks/store-link.js';
import { checkTechVersions } from './checks/tech-versions.js';
import { checkTypescriptStrict } from './checks/typescript-strict.js';
import { checkUnsafeVh } from './checks/unsafe-vh.js';
import { checkUsesGameSdk } from './checks/uses-game-sdk.js';
import { checkUsesLocalStorage } from './checks/uses-localstorage.js';
import { checkViewportSupport } from './checks/viewport-support.js';
import { type FileSource, fsFileSource, mapFileSource } from './lib/file-source.js';
import { isGameProject } from './lib/project-type.js';
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
export {
  checkAudioMuteRespect,
  checkBrandFonts,
  checkBrandTokens,
  checkBundleSize,
  checkClaudeMdSlim,
  checkDarkMode,
  checkGameNaming,
  checkHtmlMeta,
  checkLicenseMit,
  checkManifest,
  checkMaskableIcon,
  checkNoAnyTypes,
  checkNoBrandOverrides,
  checkNoConsoleLog,
  checkNoCookies,
  checkNoEnvProduction,
  checkNoExternalScripts,
  checkNoPaymentSdk,
  checkNoPlaceholders,
  checkNoScroll,
  checkNoTracking,
  checkPwaIcons,
  checkPwaMeta,
  checkPwaOffline,
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
};

/**
 * Runs every compliance check against the source. Two front doors:
 *   - `runChecks(repoDir)`        — CLI / CI; reads from disk.
 *   - `runChecksFromFiles(map)`   — VibeCode agent; reads from a Map.
 *
 * Both call the same underlying check functions via the FileSource
 * abstraction, so rules stay in one place. Results are returned in a
 * stable order so callers can render predictable output.
 */
export async function runChecks(repoDir: string): Promise<CheckResult[]> {
  return runChecksOn(fsFileSource(repoDir));
}

export async function runChecksFromFiles(files: Map<string, string>): Promise<CheckResult[]> {
  return runChecksOn(mapFileSource(files));
}

async function runChecksOn(source: FileSource): Promise<CheckResult[]> {
  return Promise.all([
    // Platform rules (hard fail)
    checkLicenseMit(source),
    checkNoEnvProduction(source),
    checkNoPlaceholders(source),
    checkNoTracking(source),
    checkNoPaymentSdk(source),
    checkNoCookies(source),
    checkNoExternalScripts(source),
    // Brand & design
    checkAudioMuteRespect(source),
    checkBrandFonts(source),
    checkBrandTokens(source),
    checkNoBrandOverrides(source),
    checkDarkMode(source),
    // Layout & viewport
    checkNoScroll(source),
    checkViewportSupport(source),
    checkUnsafeVh(source),
    // HTML & PWA
    checkHtmlMeta(source),
    checkPwaMeta(source),
    checkPwaOffline(source),
    checkManifest(source),
    checkMaskableIcon(source),
    checkPwaIcons(source),
    // SDK & code quality
    checkUsesGameSdk(source),
    checkTypescriptStrict(source),
    checkStoreLink(source),
    checkBundleSize(source),
    checkClaudeMdSlim(source),
    // Warnings (guidelines, not gates)
    checkSdkVersion(source),
    checkTechVersions(source),
    checkNoAnyTypes(source),
    checkNoConsoleLog(source),
    checkUsesLocalStorage(source),
    checkGameNaming(source),
  ]);
}
