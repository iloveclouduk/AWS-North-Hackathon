import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false, // explicit imports only — easier for the team to follow
  manifest: {
    name: 'AWS City',
    description: 'Learn AWS by exploring a living pixel city of agents.',
    // sidePanel is added automatically by WXT because a sidepanel entrypoint exists.
    permissions: ['storage', 'tabs', 'activeTab'],
    // Requested at runtime only if activeTab isn't enough for the Lookout's screenshot.
    optional_host_permissions: ['<all_urls>'],
    action: { default_title: 'Open AWS City' },
  },
});
