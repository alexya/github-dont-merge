import { browser } from 'wxt/browser';

import { createLabelSettings } from '../../utils/label-settings';
import { observeMergeWarning } from '../../utils/merge-warning';

import './style.css';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const warning = observeMergeWarning(document, []);
    const unsubscribe = createLabelSettings(browser.storage).subscribe(
      warning.setTriggerLabels,
      (error) => {
        warning.setTriggerLabels([]);
        console.error("GitHub Don't Merge: could not load synced highlight labels.", error);
      },
    );
    ctx.addEventListener(window, 'wxt:locationchange', warning.refresh);
    ctx.onInvalidated(() => {
      unsubscribe();
      warning.dispose();
    });
  },
});
