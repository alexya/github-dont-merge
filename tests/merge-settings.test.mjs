import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createMergeSettings } from '../utils/merge-settings.ts';
import { mountMergeSettings } from '../utils/merge-settings-popup.ts';

const html = await readFile(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');
const flush = () => new Promise(setImmediate);

test('merge protection defaults off, validates booleans and supports live sync and deletion', async () => {
  const listeners = new Set();
  let value;
  const emit = (next) => {
    value = next;
    for (const listener of listeners) listener({ blockMerging: { newValue: next } }, 'sync');
  };
  const settings = createMergeSettings({
    sync: {
      async get() { return { blockMerging: value }; },
      async set(items) { emit(items.blockMerging); },
    },
    onChanged: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
  });
  const received = [], errors = [];
  const stop = settings.subscribe((next) => received.push(next), (error) => errors.push(error));
  await flush();
  assert.deepEqual(received, [false]);
  await settings.save(true);
  emit(undefined);
  emit('true');
  assert.deepEqual(received, [false, true, false]);
  assert.match(errors[0].message, /invalid/);
  await assert.rejects(settings.save(1), /boolean/);
  stop();
  assert.equal(listeners.size, 0);
});

test('merge checkbox saves, reflects remote changes, reports failures and retries loading', async (t) => {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  let subscriber, onError, stopped = 0, saveError, readError = new Error('Storage unavailable');
  let saved = false;
  const settings = {
    subscribe(onValue, error) {
      subscriber = onValue;
      onError = error;
      if (readError) error(readError);
      else onValue(saved);
      return () => { stopped++; };
    },
    async save(value) {
      if (saveError) throw saveError;
      saved = value;
      subscriber(value);
    },
  };
  const dispose = mountMergeSettings(document, settings);
  t.after(() => dom.window.close());
  const checkbox = document.querySelector('#block-merging');
  const controls = document.querySelector('#merge-controls');
  const error = document.querySelector('#merge-error');
  assert.equal(controls.disabled, true);
  assert.match(error.textContent, /unavailable/);
  readError = undefined;
  document.querySelector('#retry-merge-settings').click();
  assert.equal(checkbox.checked, false);
  assert.equal(controls.disabled, false);
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.equal(saved, true);
  assert.equal(checkbox.checked, true);
  subscriber(false);
  assert.equal(checkbox.checked, false);
  saveError = new Error('Sync quota exceeded');
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.equal(checkbox.checked, false);
  assert.match(error.textContent, /quota/);
  assert.equal(controls.disabled, false);
  onError(new Error('Invalid synced value'));
  assert.equal(controls.disabled, true);
  subscriber(true);
  assert.equal(checkbox.checked, true);
  assert.equal(error.hidden, true);
  dispose();
  assert.equal(stopped, 2);
});
