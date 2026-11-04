import { createSyncedSetting, type SettingsStorage } from './synced-setting.ts';

export const MERGE_SETTINGS_KEY = 'blockMerging';

export function createMergeSettings(storage: SettingsStorage | undefined) {
  return createSyncedSetting(storage, MERGE_SETTINGS_KEY, false, (value) => {
    if (typeof value !== 'boolean') throw new Error('Saved merge-blocking setting is invalid. Expected a boolean.');
    return value;
  });
}
