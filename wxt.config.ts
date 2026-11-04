import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: "GitHub Don't Merge",
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://github.com/*'],
    optional_host_permissions: ['https://*/*'],
  },
});
