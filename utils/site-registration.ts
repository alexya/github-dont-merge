import type { browser } from 'wxt/browser';

import { sitePattern } from './site-settings.ts';

const SCRIPT_ID = 'gdm-github-sites';

export async function registerSites(
  sites: readonly string[],
  api: Pick<typeof browser, 'permissions' | 'scripting'>,
) {
  const patterns = [...new Set(sites.map(sitePattern))];
  const allowed = await Promise.all(patterns.map(async (pattern) =>
    await api.permissions.contains({ origins: [pattern] }) ? pattern : undefined,
  ));
  const matches = allowed.filter((pattern) => pattern !== undefined);
  const existing = await api.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) {
    if (existing.length) await api.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  const script = {
    id: SCRIPT_ID,
    matches,
    js: ['content-scripts/github.js'],
    css: ['content-scripts/github.css'],
    runAt: 'document_idle' as const,
    persistAcrossSessions: true,
  };
  if (existing.length) await api.scripting.updateContentScripts([script]);
  else await api.scripting.registerContentScripts([script]);
}
