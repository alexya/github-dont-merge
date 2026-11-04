import type { browser } from 'wxt/browser';

import { sitePattern } from './site-settings.ts';

const SCRIPT_ID = 'gdm-github-sites';
const JS = ['content-scripts/github.js'];
const CSS = ['content-scripts/github.css'];
// WXT types injection paths as root-relative public paths.
const INJECT_JS = ['/content-scripts/github.js' as const];
const INJECT_CSS = ['/content-scripts/github.css' as const];

type RegistrationApi = Pick<typeof browser, 'permissions' | 'scripting'>;
type InjectionApi = Pick<typeof browser, 'scripting' | 'tabs'>;

/** Registers the content script on configured, granted hosts and returns newly added match patterns. */
export async function registerSites(sites: readonly string[], api: RegistrationApi): Promise<string[]> {
  const patterns = [...new Set(sites.map(sitePattern))];
  const allowed = await Promise.all(patterns.map(async (pattern) =>
    await api.permissions.contains({ origins: [pattern] }) ? pattern : undefined,
  ));
  const matches = allowed.filter((pattern) => pattern !== undefined);
  const existing = await api.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  const previous = new Set(existing.flatMap((script) => script.matches ?? []));
  if (!matches.length) {
    if (existing.length) await api.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return [];
  }
  const script = {
    id: SCRIPT_ID,
    matches,
    js: JS,
    css: CSS,
    runAt: 'document_idle' as const,
    persistAcrossSessions: true,
  };
  if (existing.length) await api.scripting.updateContentScripts([script]);
  else await api.scripting.registerContentScripts([script]);
  return matches.filter((pattern) => !previous.has(pattern));
}

/** Injects the content script into already open tabs, which registration alone does not reach. */
export async function injectOpenTabs(patterns: readonly string[], api: InjectionApi) {
  if (!patterns.length) return;
  const tabs = await api.tabs.query({ url: [...patterns] });
  await Promise.all(tabs.map(async ({ id }) => {
    if (id === undefined) return;
    try {
      await api.scripting.insertCSS({ target: { tabId: id }, files: INJECT_CSS });
      await api.scripting.executeScript({ target: { tabId: id }, files: INJECT_JS });
    } catch {
      // Tabs can close, navigate away, or be restricted pages; they pick up the script on next load.
    }
  }));
}
