import { browser } from 'wxt/browser';

import './style.css';

const version = document.querySelector<HTMLElement>('#version');

if (!version) {
  throw new Error('The popup version element is missing.');
}

version.textContent = `Version ${browser.runtime.getManifest().version}`;
