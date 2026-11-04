import type { browser } from 'wxt/browser';

import { sitePattern, validateSites } from './site-settings.ts';

export function createSiteAccess(permissions: Pick<typeof browser.permissions, 'contains' | 'request'>) {
  return {
    hasAccess(site: string) {
      return permissions.contains({ origins: [sitePattern(site)] });
    },
    async requestAccess(values: readonly string[]) {
      const sites = validateSites(values);
      if (!sites.length) return;
      // Start the permission request in the popup's user gesture.
      const allowed = await permissions.request({ origins: [...new Set(sites.map(sitePattern))] });
      if (!allowed) throw new Error('Site saved, but access was not granted. Click Allow access to try again.');
    },
  };
}
