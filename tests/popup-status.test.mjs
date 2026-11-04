import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { SAVED_STATUS_MS, statusReporter } from '../utils/popup-status.ts';

const html = await readFile(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');

function setup(t) {
  const dom = new JSDOM(html);
  const timers = new Map();
  let next = 0;
  dom.window.setTimeout = (callback, ms) => { timers.set(++next, { callback, ms }); return next; };
  dom.window.clearTimeout = (id) => { timers.delete(id); };
  t.after(() => dom.window.close());
  const badge = dom.window.document.querySelector('#popup-status');
  return {
    document: dom.window.document,
    timers,
    shown: () => (badge.hidden ? null : badge.textContent),
    state: () => badge.dataset.state,
    tick() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(({ callback }) => callback());
    },
  };
}

test('the popup has one shared status badge and no per-section status lines', () => {
  const { document } = new JSDOM(html).window;
  assert.equal(document.querySelectorAll('[role=status]').length, 1);
  assert.equal(document.querySelector('main').firstElementChild.id, 'popup-status');
  for (const id of ['site-status', 'settings-status', 'merge-status']) assert.equal(document.getElementById(id), null);
  assert.doesNotMatch(html, /Settings loaded/);
});

test('shows loading until every section loads, then hides', (t) => {
  const f = setup(t);
  const sites = statusReporter(f.document, 'loading');
  const labels = statusReporter(f.document, 'loading');
  assert.equal(f.shown(), 'Loading...');
  sites.settle();
  assert.equal(f.shown(), 'Loading...', 'one section is still loading');
  labels.settle();
  assert.equal(f.shown(), null);
});

test('shows saving, then saved for three seconds, then hides', (t) => {
  const f = setup(t);
  const section = statusReporter(f.document);
  assert.equal(f.shown(), null);
  section.set('saving');
  assert.equal(f.shown(), 'Saving...');
  section.settle();
  assert.equal(f.shown(), 'Saving...', 'our own sync event must not hide Saving');
  section.set('saved');
  assert.equal(f.shown(), 'Saved');
  assert.equal(f.state(), 'saved');
  section.settle();
  assert.equal(f.shown(), 'Saved', 'a sync event after saving keeps Saved visible');
  assert.deepEqual([...f.timers.values()].map(({ ms }) => ms), [SAVED_STATUS_MS]);
  assert.equal(SAVED_STATUS_MS, 3000);
  f.tick();
  assert.equal(f.shown(), null);
});

test('a new save restarts the saved timer and priority is error, saving, loading, saved', (t) => {
  const f = setup(t);
  const a = statusReporter(f.document);
  const b = statusReporter(f.document);
  a.set('saved');
  a.set('saving');
  assert.equal(f.timers.size, 0, 'starting another save cancels the old hide timer');
  a.set('saved');
  b.set('loading');
  assert.equal(f.shown(), 'Loading...');
  b.set('saving');
  assert.equal(f.shown(), 'Saving...');
  b.set('error');
  assert.equal(f.shown(), 'Error');
  b.settle();
  assert.equal(f.shown(), 'Saved');
  f.tick();
  assert.equal(f.shown(), null);
});
