/**
 * The full check battery, run against any FileSource. Node-free: this
 * module imports only the check functions (which read through the
 * FileSource abstraction) and the Map adapter, so it — and the Worker
 * entry that re-exports it — bundle cleanly for Cloudflare Workers.
 *
 * The on-disk front door `runChecks(repoDir)` lives in index.ts, where
 * pulling in fsFileSource (node:fs) is fine.
 */

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
import { checkNoPagePolicy } from './checks/no-page-policy.js';
import { checkNoPaymentCapabilities } from './checks/no-payment-capabilities.js';
import { checkNoPaymentSdk } from './checks/no-payment-sdk.js';
import { checkNoPlaceholders } from './checks/no-placeholders.js';
import { checkNoScroll } from './checks/no-scroll.js';
import { checkNoTracking } from './checks/no-tracking.js';
import { checkPermissionsDeclared } from './checks/permissions-declared.js';
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
import { type FileSource, mapFileSource } from './lib/file-source.js';
import type { CheckResult } from './types.js';

/**
 * VibeCode agent front door — reads from the in-memory Map the agent's
 * session DO holds. No filesystem access, so it's safe in a Worker.
 */
export async function runChecksFromFiles(files: Map<string, string>): Promise<CheckResult[]> {
  return runChecksOn(mapFileSource(files));
}

export async function runChecksOn(source: FileSource): Promise<CheckResult[]> {
  return Promise.all([
    // Platform rules (hard fail)
    checkLicenseMit(source),
    checkNoEnvProduction(source),
    checkNoPlaceholders(source),
    checkNoTracking(source),
    checkNoPaymentSdk(source),
    checkNoPaymentCapabilities(source),
    checkNoCookies(source),
    checkNoExternalScripts(source),
    checkNoExternalFetch(source),
    checkNoPagePolicy(source),
    checkPermissionsDeclared(source),
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
    checkNoHardcodedColors(source),
    checkNoExcessiveInlineStyles(source),
    checkDeployWorkflow(source),
    checkGitignoreComplete(source),
    checkReactStrictMode(source),
  ]);
}
