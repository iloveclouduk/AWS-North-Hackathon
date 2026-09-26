import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

// A fixed public key gives the unpacked extension the same id on every machine (scripts/extension-id.mjs),
// so the Cognito callback https://<id>.chromiumapp.org/ always matches. Store uploads leave it out:
// the Chrome Web Store assigns its own id (release builds set WXT_STORE_BUILD=true).
const key = process.env.WXT_STORE_BUILD === 'true' ? undefined : readFileSync('extension.pubkey', 'utf8').trim();

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false, // explicit imports only — easier for the team to follow
  manifest: {
    name: 'AWS City',
    description: 'Learn AWS by exploring a living pixel city of agents.',
    // sidePanel is added automatically by WXT because a sidepanel entrypoint exists.
    permissions: ['storage', 'tabs', 'activeTab', 'identity'],
    // Requested at runtime only if activeTab isn't enough for the Lookout's screenshot.
    optional_host_permissions: ['<all_urls>'],
    action: { default_title: 'Open AWS City' },
    ...(key ? { key } : {}),
  },
});
