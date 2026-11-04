import type { browser } from 'wxt/browser';

import { DEFAULT_TRIGGER_LABELS } from '../config/trigger-labels.ts';

export const LABEL_SETTINGS_KEY = 'triggerLabels';

type LabelStorage = Pick<typeof browser.storage, 'sync' | 'onChanged'>;

export function validateLabels(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((label) => typeof label === 'string')) {
    throw new Error('Saved labels are invalid. Expected a list of label names.');
  }
  const labels = value.map((label: string) => label.trim());
  if (labels.some((label) => !label)) {
    throw new Error('Enter a label name.');
  }
  if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
    throw new Error('This label is already monitored (ignoring case).');
  }
  return labels;
}

export function createLabelSettings(
  storage: LabelStorage | undefined,
) {
  const requireStorage = (): LabelStorage => {
    if (!storage?.sync || !storage.onChanged) {
      throw new Error(
        "Sync storage is unavailable. Reload the extension from your browser's extensions page and check its storage permission.",
      );
    }
    return storage;
  };

  return {
    async save(labels: readonly string[]) {
      await requireStorage().sync.set({ [LABEL_SETTINGS_KEY]: validateLabels(labels) });
    },
    subscribe(onLabels: (labels: string[]) => void, onError: (error: unknown) => void) {
      let api: LabelStorage;
      try {
        api = requireStorage();
      } catch (error) {
        onError(error);
        return () => {};
      }

      let active = true;
      let listening = false;
      let revision = 0;
      const deliver = (value: unknown) => {
        let labels: string[];
        try {
          labels = validateLabels(value === undefined ? DEFAULT_TRIGGER_LABELS : value);
        } catch (error) {
          onError(error);
          return;
        }
        onLabels(labels);
      };
      const listener: Parameters<LabelStorage['onChanged']['addListener']>[0] = (changes, area) => {
        if (!active || area !== 'sync' || !Object.hasOwn(changes, LABEL_SETTINGS_KEY)) return;
        revision++;
        deliver(changes[LABEL_SETTINGS_KEY]?.newValue);
      };
      try {
        api.onChanged.addListener(listener);
        listening = true;
        const initialRevision = revision;
        void api.sync.get(LABEL_SETTINGS_KEY).then(
          (items) => {
            // A newer sync event must not be overwritten by a stale startup read.
            if (active && revision === initialRevision) deliver(items[LABEL_SETTINGS_KEY]);
          },
          (error: unknown) => {
            if (active && revision === initialRevision) onError(error);
          },
        );
      } catch (error) {
        onError(error);
      }
      return () => {
        active = false;
        if (listening) api.onChanged.removeListener(listener);
      };
    },
  };
}
