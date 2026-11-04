import type { browser } from 'wxt/browser';

export type SettingsStorage = Pick<typeof browser.storage, 'sync' | 'onChanged'>;

export function createSyncedSetting<T>(
  storage: SettingsStorage | undefined,
  key: string,
  defaults: T,
  validate: (value: unknown) => T,
) {
  const requireStorage = (): SettingsStorage => {
    if (!storage?.sync || !storage.onChanged) {
      throw new Error(
        "Sync storage is unavailable. Reload the extension from your browser's extensions page and check its storage permission.",
      );
    }
    return storage;
  };

  return {
    async save(value: T) {
      await requireStorage().sync.set({ [key]: validate(value) });
    },
    subscribe(onValue: (value: T) => void, onError: (error: unknown) => void) {
      let api: SettingsStorage;
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
        let next: T;
        try {
          next = validate(value === undefined ? defaults : value);
        } catch (error) {
          onError(error);
          return;
        }
        onValue(next);
      };
      const listener: Parameters<SettingsStorage['onChanged']['addListener']>[0] = (changes, area) => {
        if (!active || area !== 'sync' || !Object.hasOwn(changes, key)) return;
        revision++;
        deliver(changes[key]?.newValue);
      };
      try {
        api.onChanged.addListener(listener);
        listening = true;
        const initialRevision = revision;
        void api.sync.get(key).then(
          (items) => {
            // A newer sync event must not be overwritten by a stale startup read.
            if (active && revision === initialRevision) deliver(items[key]);
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
