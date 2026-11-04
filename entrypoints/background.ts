import { browser } from 'wxt/browser';

import { createSiteSettings } from '../utils/site-settings';
import { registerSites } from '../utils/site-registration';

export default defineBackground(() => {
  let sites: readonly string[] = [];
  let pending = Promise.resolve();
  const update = () => {
    pending = pending.then(() => registerSites(sites, browser)).catch((error: unknown) => {
      console.error("GitHub Don't Merge: could not register configured GitHub sites.", error);
    });
  };
  createSiteSettings(browser.storage).subscribe(
    (next) => { sites = next; update(); },
    (error) => {
      sites = [];
      update();
      console.error("GitHub Don't Merge: could not load configured GitHub sites.", error);
    },
  );
  browser.permissions.onAdded.addListener(update);
  browser.permissions.onRemoved.addListener(update);
});
