import { TRIGGER_LABELS } from '../../config/trigger-labels';
import { observeMergeWarning } from '../../utils/merge-warning';

import './style.css';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const warning = observeMergeWarning(document, TRIGGER_LABELS);
    ctx.addEventListener(window, 'wxt:locationchange', warning.refresh);
    ctx.onInvalidated(warning.dispose);
  },
});
