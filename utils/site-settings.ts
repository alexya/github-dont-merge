import { createSyncedSetting, type SettingsStorage } from './synced-setting.ts';

export const SITE_SETTINGS_KEY = 'githubSites';
export const DEFAULT_SITES = ['https://github.com'];

export function normalizeSite(value: string): string {
  const input = value.trim();
  if (!input) throw new Error('Enter a GitHub hostname or HTTPS origin.');
  let url: URL;
  try {
    url = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    throw new Error('Enter a valid GitHub hostname or HTTPS origin.');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.hostname.includes('*') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS origin without a path, credentials, query, or wildcard.');
  }
  return url.origin;
}

export function validateSites(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((site) => typeof site === 'string')) {
    throw new Error('Saved sites are invalid. Expected a list of HTTPS origins.');
  }
  const sites = value.map(normalizeSite);
  if (new Set(sites).size !== sites.length) {
    throw new Error('This GitHub site is already monitored.');
  }
  return sites;
}

export function sitePattern(site: string): string {
  // Match patterns do not support ports. The content script also checks the exact origin.
  return `https://${new URL(site).hostname}/*`;
}

export function createSiteSettings(storage: SettingsStorage | undefined) {
  return createSyncedSetting<readonly string[]>(storage, SITE_SETTINGS_KEY, DEFAULT_SITES, validateSites);
}
