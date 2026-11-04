import { browser } from 'wxt/browser';

import { createLabelSettings } from '../../utils/label-settings';
import { mountLabelSettings, mountListSettings } from '../../utils/label-settings-popup';
import { createSiteSettings, DEFAULT_SITES } from '../../utils/site-settings';
import { createSiteAccess } from '../../utils/site-permissions';

import './style.css';

const version = document.querySelector<HTMLElement>('#version');

if (!version) {
  throw new Error('The popup version element is missing.');
}

version.textContent = `Version ${browser.runtime.getManifest().version}`;

const dispose = mountLabelSettings(document, createLabelSettings(browser.storage));
const disposeSites = mountListSettings(document, createSiteSettings(browser.storage), {
  prefix: 'site',
  defaults: DEFAULT_SITES,
  savedMessage: 'Saved. Reload newly added or authorized sites to activate warnings.',
  ...createSiteAccess(browser.permissions),
});
window.addEventListener('pagehide', () => { dispose(); disposeSites(); }, { once: true });
