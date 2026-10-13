import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'wxt';
import { FIREFOX_ADDON_ID } from './scripts/extension-id.mjs';

// A fixed public key gives the unpacked Chrome extension the same id on every machine (scripts/extension-id.mjs),
// so the Cognito callback https://<id>.chromiumapp.org/ always matches. Store uploads leave it out:
// the Chrome Web Store assigns its own id (release builds set WXT_STORE_BUILD=true).
const key = process.env.WXT_STORE_BUILD === 'true' ? undefined : readFileSync('extension.pubkey', 'utf8').trim();

// Branded Google Chrome ignores --load-extension, so `npm run dev` opened an empty about:blank. Playwright's
// Chrome for Testing still loads unpacked extensions: use it when installed (npx playwright install chromium).
const chromeForTesting = (() => {
  try {
    const path = (createRequire(import.meta.url)('playwright') as typeof import('playwright')).chromium.executablePath();
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
})();

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false, // explicit imports only — easier for the team to follow
  webExt: {
    binaries: chromeForTesting ? { chrome: chromeForTesting } : undefined,
    startUrls: ['https://console.aws.amazon.com/s3/home'],
  },
  // Firefox Add-ons (AMO) reviews the source used to build the extension: only what the build reads goes in
  // (no server, infra or cdk.out — those hold nothing the extension uses).
  zip: { excludeSources: ['infra/**', 'server/**', 'art/**', 'tests/**', 'docs/**', 'agentic-city/**', 'backend/**', 'CLAUDE.md', 'aws-city.config.json'] },
  // WXT builds Firefox and Safari as MV2 unless told otherwise (core/resolve-config.ts); every browser gets MV3.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'AWS City',
    description: 'Learn AWS by exploring a living pixel city of agents.',
    // Chrome: sidePanel is added by WXT because a sidepanel entrypoint exists. Firefox: WXT turns the same
    // entrypoint into sidebar_action. Safari has neither (the toolbar opens the full city in a tab) and no identity API.
    permissions: browser === 'safari' ? ['storage', 'tabs', 'activeTab'] : ['storage', 'tabs', 'activeTab', 'identity'],
    // Requested at runtime only if activeTab isn't enough for the Lookout's screenshot.
    optional_host_permissions: ['<all_urls>'],
    action: { default_title: 'Open AWS City' },
    ...(browser === 'chrome' && key ? { key } : {}),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              // Fixed id: Firefox derives the sign-in redirect URL from it (scripts/extension-id.mjs firefoxRedirectUrl).
              id: FIREFOX_ADDON_ID,
              // The built-in data consent (required for new add-ons) needs Firefox 140.
              strict_min_version: '140.0',
              // What leaves the browser, for AWS City features: sign-in, chat with the agents, the AWS page you're on,
              // and Lookout screenshots / console labels (docs/privacy-policy.md).
              data_collection_permissions: { required: ['authenticationInfo', 'personalCommunications', 'browsingActivity', 'websiteContent'] },
            },
            // Same consent system on Android needs 142 (Extension Workshop: firefox-builtin-data-consent).
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : {}),
  }),
});
