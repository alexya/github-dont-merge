import { browser } from 'wxt/browser';

import { createLabelSettings } from '../../utils/label-settings';
import { observeMergeWarning } from '../../utils/merge-warning';
import { createSiteSettings } from '../../utils/site-settings';

import './style.css';

export default defineContentScript({
  matches: ['https://github.com/*'],
  registration: 'runtime',
  runAt: 'document_idle',
  main(ctx) {
    let labels: readonly string[] = [];
    let enabled = false;
    let warning: ReturnType<typeof observeMergeWarning> | undefined;
    const update = () => {
      if (enabled) {
        warning ??= observeMergeWarning(document, []);
        warning.setTriggerLabels(labels);
      } else {
        warning?.dispose();
        warning = undefined;
      }
    };
    const unsubscribeLabels = createLabelSettings(browser.storage).subscribe(
      (next) => { labels = next; update(); },
      (error) => {
        labels = [];
        update();
        console.error("GitHub Don't Merge: could not load synced highlight labels.", error);
      },
    );
    const unsubscribeSites = createSiteSettings(browser.storage).subscribe(
      (sites) => { enabled = sites.includes(location.origin); update(); },
      (error) => {
        enabled = false;
        update();
        console.error("GitHub Don't Merge: could not load configured GitHub sites.", error);
      },
    );
    ctx.addEventListener(window, 'wxt:locationchange', () => warning?.refresh());
    ctx.onInvalidated(() => {
      unsubscribeLabels();
      unsubscribeSites();
      warning?.dispose();
    });
  },
});
