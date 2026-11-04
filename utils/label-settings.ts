import { DEFAULT_TRIGGER_LABELS } from '../config/trigger-labels.ts';
import { createSyncedSetting, type SettingsStorage } from './synced-setting.ts';

export const LABEL_SETTINGS_KEY = 'triggerLabels';

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
  storage: SettingsStorage | undefined,
) {
  return createSyncedSetting<readonly string[]>(
    storage, LABEL_SETTINGS_KEY, DEFAULT_TRIGGER_LABELS, validateLabels,
  );
}
