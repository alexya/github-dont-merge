import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { DEFAULT_TRIGGER_LABELS } from '../config/trigger-labels.ts';
import { createLabelSettings, LABEL_SETTINGS_KEY, validateLabels } from '../utils/label-settings.ts';
import { mountLabelSettings } from '../utils/label-settings-popup.ts';
import { observeMergeWarning } from '../utils/merge-warning.ts';

const popupHtml = await readFile(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');
const flush = () => new Promise(setImmediate);

function fakeStorage(initialValue) {
  const listeners = new Set();
  const state = { value: initialValue, writes: 0, getError: undefined, setError: undefined };
  const emit = (value, area = 'sync', key = LABEL_SETTINGS_KEY) => {
    if (area === 'sync' && key === LABEL_SETTINGS_KEY) state.value = value;
    for (const listener of listeners) listener({ [key]: { newValue: value } }, area);
  };
  const storage = {
    sync: {
      async get() {
        if (state.getError) throw state.getError;
        return { [LABEL_SETTINGS_KEY]: structuredClone(state.value) };
      },
      async set(items) {
        if (state.setError) throw state.setError;
        state.writes++;
        emit(structuredClone(items[LABEL_SETTINGS_KEY]));
      },
    },
    onChanged: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
  };
  return { storage, state, emit, listeners, settings: createLabelSettings(storage) };
}

function popup(t, backing = fakeStorage()) {
  const dom = new JSDOM(popupHtml);
  const { document } = dom.window;
  const dispose = mountLabelSettings(document, backing.settings);
  t.after(() => { dispose(); dom.window.close(); });
  return {
    ...backing, document, dispose,
    input: document.querySelector('#label-name'),
    controls: document.querySelector('#label-controls'),
    names: () => Array.from(document.querySelectorAll('#label-list li > span'), (e) => e.textContent),
    error: () => document.querySelector('#settings-error'),
    async add(name) {
      this.input.value = name;
      document.querySelector('#label-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
      await flush();
    },
  };
}

test('defaults contain only the two requested labels and are not written during reads', async () => {
  const f = fakeStorage();
  let labels;
  const stop = f.settings.subscribe((value) => { labels = value; }, assert.fail);
  await flush();
  assert.deepEqual(labels, ['do not merge', 'do-not-merge']);
  assert.equal(f.state.writes, 0);
  stop();
  assert.equal(f.listeners.size, 0);
});

test('validates names, trims whitespace and rejects case-insensitive duplicates', () => {
  assert.deepEqual(validateLabels([' Hold ', 'Not Ready To Merge']), ['Hold', 'Not Ready To Merge']);
  assert.deepEqual(validateLabels([]), []);
  for (const value of [null, {}, 'hold', [1], ['hold', null]]) {
    assert.throws(() => validateLabels(value), /invalid/);
  }
  assert.throws(() => validateLabels(['  ']), /Enter a label name/);
  assert.throws(() => validateLabels([' HOLD ', 'hold']), /already monitored/);
});

test('persists custom settings and empty lists across subscribers without falling back', async () => {
  const f = fakeStorage();
  await f.settings.save([' Not Ready To Merge ']);
  let labels;
  let stop = f.settings.subscribe((value) => { labels = value; }, assert.fail);
  await flush();
  assert.deepEqual(labels, ['Not Ready To Merge']);
  stop();
  await f.settings.save([]);
  stop = createLabelSettings(f.storage).subscribe((value) => { labels = value; }, assert.fail);
  await flush();
  assert.deepEqual(labels, []);
  stop();
});

test('only watches the sync setting, restores missing defaults and cleans up', async () => {
  const f = fakeStorage(['hold']);
  const received = [];
  const stop = f.settings.subscribe((value) => received.push(value), assert.fail);
  await flush();
  f.emit(['ignored'], 'local');
  f.emit(['ignored'], 'sync', 'other');
  assert.deepEqual(received, [['hold']]);
  f.emit([]);
  f.emit(undefined);
  assert.deepEqual(received, [['hold'], [], [...DEFAULT_TRIGGER_LABELS]]);
  stop();
  f.emit(['after disposal']);
  assert.equal(received.length, 3);
});

test('new sync events win over stale startup reads, including stale read failures', async () => {
  for (const fail of [false, true]) {
    const f = fakeStorage();
    let resolve, reject;
    f.storage.sync.get = () => new Promise((ok, error) => { resolve = ok; reject = error; });
    const received = [];
    const stop = f.settings.subscribe((value) => received.push(value), assert.fail);
    f.emit(['newer']);
    if (fail) reject(new Error('stale failure'));
    else resolve({ [LABEL_SETTINGS_KEY]: ['stale'] });
    await flush();
    assert.deepEqual(received, [['newer']]);
    stop();
  }
});

test('disposal prevents pending startup reads from invoking either callback', async () => {
  for (const fail of [false, true]) {
    const f = fakeStorage();
    let resolve, reject;
    f.storage.sync.get = () => new Promise((ok, error) => { resolve = ok; reject = error; });
    const stop = f.settings.subscribe(assert.fail, assert.fail);
    stop();
    if (fail) reject(new Error('late error'));
    else resolve({ [LABEL_SETTINGS_KEY]: [] });
    await flush();
  }
});

test('reports read failures, corrupted settings and write failures without overwriting storage', async () => {
  const f = fakeStorage(['hold']);
  f.state.getError = new Error('Storage unavailable');
  const errors = [];
  const received = [];
  const stop = f.settings.subscribe((labels) => received.push(labels), (error) => errors.push(error));
  await flush();
  assert.match(errors[0].message, /unavailable/);
  f.emit(null);
  assert.match(errors[1].message, /invalid/);
  f.emit(['recovered']);
  assert.deepEqual(received, [['recovered']]);
  f.state.setError = new Error('Sync quota exceeded');
  await assert.rejects(f.settings.save(['new']), /quota/);
  await assert.rejects(f.settings.save([' ']), /Enter a label name/);
  assert.equal(f.state.writes, 0);
  assert.deepEqual(f.state.value, ['recovered']);
  stop();
});

test('popup adds, removes, clears, restores and persists monitored labels', async (t) => {
  const f = popup(t);
  assert.equal(f.controls.disabled, true);
  await flush();
  assert.deepEqual(f.names(), DEFAULT_TRIGGER_LABELS);
  assert.equal(f.controls.disabled, false);
  await f.add(' Not Ready To Merge ');
  assert.deepEqual(f.names(), [...DEFAULT_TRIGGER_LABELS, 'Not Ready To Merge']);
  assert.equal(f.input.value, '');
  while (f.document.querySelector('.remove-label')) {
    f.document.querySelector('.remove-label').click();
    await flush();
  }
  assert.deepEqual(f.state.value, []);
  assert.equal(f.document.querySelector('#empty-labels').hidden, false);
  f.dispose();
  const reopened = popup(t, f);
  await flush();
  assert.deepEqual(reopened.names(), []);
  reopened.document.querySelector('#restore-defaults').click();
  await flush();
  assert.deepEqual(reopened.names(), DEFAULT_TRIGGER_LABELS);
  assert.deepEqual(f.state.value, DEFAULT_TRIGGER_LABELS);
});

test('popup rejects blank and duplicate names and preserves input on failed saves', async (t) => {
  const f = popup(t);
  await flush();
  await f.add(' ');
  assert.equal(f.error().hidden, false);
  assert.match(f.error().textContent, /Enter a label name/);
  await f.add(' DO NOT MERGE ');
  assert.match(f.error().textContent, /already monitored/);
  assert.equal(f.state.writes, 0);
  f.state.setError = new Error('Sync quota exceeded');
  await f.add('Custom');
  assert.equal(f.input.value, 'Custom');
  assert.match(f.error().textContent, /quota/);
  assert.equal(f.document.querySelector('#popup-status').dataset.state, 'error');
  assert.deepEqual(f.names(), DEFAULT_TRIGGER_LABELS);
  assert.equal(f.controls.disabled, false);
  f.state.setError = undefined;
  await f.add('Custom');
  assert.equal(f.error().hidden, true);
  assert.ok(f.names().includes('Custom'));
});

test('popup exposes retry on read errors and never silently overwrites failed settings', async (t) => {
  const backing = fakeStorage(['custom']);
  backing.state.getError = new Error('Sync unavailable');
  const f = popup(t, backing);
  await flush();
  assert.equal(f.controls.disabled, true);
  assert.match(f.error().textContent, /unavailable/);
  assert.equal(f.document.querySelector('#retry-settings').hidden, false);
  assert.equal(f.state.writes, 0);
  backing.state.getError = undefined;
  f.document.querySelector('#retry-settings').click();
  await flush();
  assert.deepEqual(f.names(), ['custom']);
  assert.equal(f.controls.disabled, false);
  assert.equal(f.listeners.size, 1);
});

test('popup reports missing storage permission instead of loading indefinitely', async (t) => {
  const backing = fakeStorage();
  backing.settings = createLabelSettings(undefined);
  const f = popup(t, backing);
  assert.equal(f.controls.disabled, true);
  assert.equal(f.document.querySelector('#popup-status').dataset.state, 'error');
  assert.equal(f.error().hidden, false);
  assert.match(f.error().textContent, /Reload the extension.*storage permission/);
  assert.equal(f.document.querySelector('#retry-settings').hidden, false);
  f.document.querySelector('#retry-settings').click();
  assert.match(f.error().textContent, /Reload the extension/);
  await assert.rejects(backing.settings.save(['custom']), /storage is unavailable/);
});

test('popup reports synchronous listener setup failures and can retry', async (t) => {
  const backing = fakeStorage(['custom']);
  const addListener = backing.storage.onChanged.addListener;
  backing.storage.onChanged.addListener = () => { throw new Error('Listener setup failed'); };
  const f = popup(t, backing);
  assert.equal(f.controls.disabled, true);
  assert.equal(f.document.querySelector('#popup-status').dataset.state, 'error');
  assert.match(f.error().textContent, /Listener setup failed/);
  assert.equal(f.listeners.size, 0);
  backing.storage.onChanged.addListener = addListener;
  f.document.querySelector('#retry-settings').click();
  await flush();
  assert.deepEqual(f.names(), ['custom']);
  assert.equal(f.controls.disabled, false);
  assert.equal(f.listeners.size, 1);
});

test('popup reports synchronous storage read failures and recovers on a change', (t) => {
  const backing = fakeStorage();
  backing.storage.sync.get = () => { throw new Error('Sync read failed'); };
  const f = popup(t, backing);
  assert.equal(f.controls.disabled, true);
  assert.equal(f.document.querySelector('#popup-status').dataset.state, 'error');
  assert.match(f.error().textContent, /Sync read failed/);
  assert.equal(f.listeners.size, 1);
  f.emit(['recovered']);
  assert.deepEqual(f.names(), ['recovered']);
  assert.equal(f.controls.disabled, false);
  assert.equal(f.error().hidden, true);
});

test('popup renders names as text and updates on remote settings changes', async (t) => {
  const f = popup(t);
  await flush();
  const name = '<img src=x onerror=alert(1)>';
  f.emit([name]);
  assert.deepEqual(f.names(), [name]);
  assert.equal(f.document.querySelector('#label-list img'), null);
  f.emit('corrupt');
  assert.equal(f.controls.disabled, true);
  assert.match(f.error().textContent, /invalid/);
  f.emit([]);
  assert.equal(f.controls.disabled, false);
  assert.equal(f.error().hidden, true);
  f.dispose();
  assert.equal(f.listeners.size, 0);
});

test('synced popup changes update an existing PR controller without reloading', async (t) => {
  const f = popup(t);
  const dom = new JSDOM(`
    <aside class="js-issue-labels">
      <a class="IssueLabel" data-name="do not merge">do not merge</a>
      <a class="IssueLabel" data-name="Not Ready To Merge">Not Ready To Merge</a>
    </aside>
    <div class="merge-message"><button>Merge pull request</button></div>
  `, { url: 'https://github.com/owner/repo/pull/1', pretendToBeVisual: true });
  dom.window.matchMedia = () => new dom.window.EventTarget();
  const controller = observeMergeWarning(dom.window.document, []);
  const stop = f.settings.subscribe(controller.setTriggerLabels, assert.fail);
  t.after(() => { stop(); controller.dispose(); dom.window.close(); });
  const frames = async () => {
    await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
    await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  };
  const badges = () => Array.from(dom.window.document.querySelectorAll('.gdm-warning-labels span'), (e) => e.textContent);
  await flush();
  await frames();
  assert.deepEqual(badges(), ['do not merge']);
  await f.add('Not Ready To Merge');
  await frames();
  assert.deepEqual(badges(), ['do not merge', 'Not Ready To Merge']);
  await f.settings.save([]);
  await frames();
  assert.deepEqual(badges(), []);
});
