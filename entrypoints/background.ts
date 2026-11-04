import { browser } from 'wxt/browser';

import { createSiteSettings } from '../utils/site-settings';
import { injectOpenTabs, registerSites } from '../utils/site-registration';

export default defineBackground(() => {
  let sites: readonly string[] = [];
  let pending = Promise.resolve();
  let loaded = false;
  let injectAll = false;
  const update = () => {
    // Avoid unregistering everything before the synced site list has loaded.
    if (!loaded) return;
    pending = pending.then(async () => {
      const added = await registerSites(sites, browser);
      const all = injectAll;
      injectAll = false;
      // After install or reload, old tab scripts are orphaned, so refresh every matching tab.
      const patterns = all
        ? (await browser.scripting.getRegisteredContentScripts()).flatMap((script) => script.matches ?? [])
        : added;
      await injectOpenTabs(patterns, browser);
    }).catch((error: unknown) => {
      console.error("GitHub Don't Merge: could not register configured GitHub sites.", error);
    });
  };
  browser.runtime.onInstalled.addListener(() => {
    injectAll = true;
    update();
  });
  createSiteSettings(browser.storage).subscribe(
    (next) => { sites = next; loaded = true; update(); },
    (error) => {
      sites = [];
      loaded = true;
      update();
      console.error("GitHub Don't Merge: could not load configured GitHub sites.", error);
    },
  );
  browser.permissions.onAdded.addListener(update);
  browser.permissions.onRemoved.addListener(update);
});
