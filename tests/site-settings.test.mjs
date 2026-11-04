import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { mountListSettings } from '../utils/label-settings-popup.ts';
import { createSiteAccess } from '../utils/site-permissions.ts';
import { registerSites } from '../utils/site-registration.ts';
import {
  createSiteSettings, DEFAULT_SITES, normalizeSite, sitePattern, validateSites,
} from '../utils/site-settings.ts';

const html = await readFile(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');
const flush = () => new Promise(setImmediate);

test('normalizes exact HTTPS origins and rejects unsafe or ambiguous site input', () => {
  assert.equal(normalizeSite(' GITHUB.Company.com '), 'https://github.company.com');
  assert.equal(normalizeSite('https://GitHub.Company.com:8443/'), 'https://github.company.com:8443');
  assert.equal(sitePattern('https://github.company.com:8443'), 'https://github.company.com/*');
  assert.deepEqual(validateSites([]), []);
  for (const site of [
    '', 'http://github.com', 'https://*.example.com', 'https://user:pass@example.com',
    'https://example.com/pull/1', 'https://example.com/?query=1', 'https://example.com/#fragment',
    'https://', 'https://example.com:bad',
  ]) assert.throws(() => normalizeSite(site));
  assert.throws(() => validateSites(['GITHUB.COM', 'https://github.com/']), /already monitored/);
  assert.throws(() => validateSites([42]), /invalid/);
});

function backing() {
  const listeners = new Set();
  const items = {};
  const storage = {
    sync: {
      async get(key) { return { [key]: items[key] }; },
      async set(next) {
        Object.assign(items, next);
        for (const listener of listeners) {
          listener(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }])), 'sync');
        }
      },
    },
    onChanged: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
  };
  return { settings: createSiteSettings(storage), items, listeners };
}

test('site settings default to GitHub and preserve an empty list across subscriptions', async () => {
  const f = backing();
  let sites;
  const stop = f.settings.subscribe((next) => { sites = next; }, assert.fail);
  await flush();
  assert.deepEqual(sites, DEFAULT_SITES);
  await f.settings.save([]);
  assert.deepEqual(sites, []);
  stop();
  const stopAgain = f.settings.subscribe((next) => { sites = next; }, assert.fail);
  await flush();
  assert.deepEqual(sites, []);
  stopAgain();
  assert.equal(f.listeners.size, 0);
});

test('popup requests exact site permissions in the user gesture, handles denial, removal and remote access', async (t) => {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const f = backing();
  const granted = new Set(['https://github.com/*']);
  let allowed = true;
  const requests = [];
  const access = createSiteAccess({
    async contains({ origins }) { return origins.every((origin) => granted.has(origin)); },
    async request({ origins }) {
      requests.push(origins);
      if (allowed) origins.forEach((origin) => granted.add(origin));
      return allowed;
    },
  });
  const dispose = mountListSettings(document, f.settings, {
    prefix: 'site', defaults: DEFAULT_SITES, savedMessage: 'Reload newly added sites.', ...access,
  });
  t.after(() => { dispose(); dom.window.close(); });
  const add = (value) => {
    document.querySelector('#site-name').value = value;
    document.querySelector('#site-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  };
  await flush();
  assert.equal(document.querySelector('#site-controls').disabled, false);
  add(' GitHub.company.com ');
  assert.equal(requests.length, 1, 'permission request starts before awaiting storage');
  await flush();
  assert.deepEqual(f.items.githubSites, ['https://github.com', 'https://github.company.com']);
  assert.deepEqual(requests[0], ['https://github.com/*', 'https://github.company.com/*']);
  allowed = false;
  add('denied.example.com');
  await flush();
  assert.match(document.querySelector('#site-error').textContent, /saved, but access was not granted/);
  assert.equal(document.querySelector('#site-name').value, '');
  assert.deepEqual(f.items.githubSites.at(-1), 'https://denied.example.com');
  const deniedItem = [...document.querySelectorAll('#site-list li')].at(-1);
  assert.equal(deniedItem.querySelector('.secondary').hidden, false, 'denied sites offer Allow access');
  await f.settings.save(['https://github.com', 'https://github.company.com']);
  await flush();
  add('http://bad.example.com');
  await flush();
  assert.equal(requests.length, 2, 'invalid sites never request permissions');
  assert.match(document.querySelector('#site-error').textContent, /HTTPS/);
  assert.deepEqual(f.items.githubSites, ['https://github.com', 'https://github.company.com']);
  allowed = true;
  await f.settings.save(['https://remote.example.com']);
  await flush();
  assert.equal(document.querySelector('#site-list .secondary').hidden, false);
  document.querySelector('#site-list .secondary').click();
  await flush();
  assert.ok(granted.has('https://remote.example.com/*'));
  assert.equal(document.querySelector('#site-list .secondary').hidden, true);
  document.querySelector('.remove-site').click();
  await flush();
  assert.deepEqual(f.items.githubSites, []);
  assert.equal(document.querySelector('#empty-sites').hidden, false);
  document.querySelector('#restore-sites').click();
  await flush();
  assert.deepEqual(f.items.githubSites, DEFAULT_SITES);
});

test('adding a site persists it even when the permission prompt closes the popup', async (t) => {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const f = backing();
  const access = createSiteAccess({
    async contains() { return false; },
    request: () => new Promise(() => {}),
  });
  const dispose = mountListSettings(document, f.settings, {
    prefix: 'site', defaults: DEFAULT_SITES, savedMessage: 'Saved.', ...access,
  });
  t.after(() => dom.window.close());
  await flush();
  document.querySelector('#site-name').value = 'git.autodesk.com';
  document.querySelector('#site-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  dispose();
  await flush();
  assert.deepEqual(f.items.githubSites, ['https://github.com', 'https://git.autodesk.com']);
});

test('registration only injects on configured and granted hosts and unregisters empty/revoked lists', async () => {
  let registered = [];
  const calls = [];
  const granted = new Set(['https://github.com/*', 'https://git.example.com/*']);
  const api = {
    permissions: { async contains({ origins }) { return granted.has(origins[0]); } },
    scripting: {
      async getRegisteredContentScripts() { return registered; },
      async registerContentScripts(scripts) { calls.push('register'); registered = scripts; },
      async updateContentScripts(scripts) { calls.push('update'); registered = scripts; },
      async unregisterContentScripts() { calls.push('unregister'); registered = []; },
    },
  };
  await registerSites(['https://github.com', 'https://missing.example.com'], api);
  assert.deepEqual(registered[0].matches, ['https://github.com/*']);
  assert.deepEqual(registered[0].js, ['content-scripts/github.js']);
  assert.deepEqual(registered[0].css, ['content-scripts/github.css']);
  await registerSites(['https://git.example.com:8443', 'https://git.example.com'], api);
  assert.deepEqual(registered[0].matches, ['https://git.example.com/*']);
  granted.clear();
  await registerSites(['https://git.example.com'], api);
  assert.deepEqual(registered, []);
  await registerSites([], api);
  assert.deepEqual(calls, ['register', 'update', 'unregister']);
  await assert.rejects(registerSites(DEFAULT_SITES, {
    ...api, permissions: { async contains() { throw new Error('Permission lookup failed'); } },
  }), /Permission lookup failed/);
});
