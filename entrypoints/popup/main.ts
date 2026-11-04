import { browser } from 'wxt/browser';

import { createLabelSettings } from '../../utils/label-settings';
import { mountLabelSettings } from '../../utils/label-settings-popup';

import './style.css';

const version = document.querySelector<HTMLElement>('#version');

if (!version) {
  throw new Error('The popup version element is missing.');
}

version.textContent = `Version ${browser.runtime.getManifest().version}`;

const dispose = mountLabelSettings(document, createLabelSettings(browser.storage));
window.addEventListener('pagehide', dispose, { once: true });
