import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { TRIGGER_LABELS } from '../config/trigger-labels.ts';
import { observeMergeWarning } from '../utils/merge-warning.ts';

const stylesheet = await readFile(
  new URL('../entrypoints/github.content/style.css', import.meta.url),
  'utf8',
);
const modernMergeBox = `
  <div data-testid="mergebox-partial">
    <div><div>
      <section id="checks"><h3>All checks have passed</h3></section>
      <section><button>Update branch</button></section>
      <div id="merge-actions">
        <div><button id="merge-button">Squash and merge</button><button>More options</button></div>
        <p>Merge this pull request</p>
      </div>
    </div></div>
  </div>`;

function fixture(t, options = {}) {
  const dom = new JSDOM(`
    <style>${stylesheet}</style>
    <aside><div class="js-issue-labels"></div></aside>
    <div class="timeline"><span class="IssueLabel" data-name="do not merge">do not merge</span></div>
    <div role="listbox"><span class="IssueLabel" data-name="do-not-merge">do-not-merge</span></div>
    ${options.markup ?? modernMergeBox}
  `, {
    url: `https://github.com/owner/repo${options.path ?? '/pull/1'}`,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;
  const theme = new window.EventTarget();
  window.matchMedia = () => theme;
  let controller;
  t.after(() => {
    controller?.dispose();
    window.close();
  });

  const addLabel = (name, background = '#a21b53') => {
    const label = document.createElement('a');
    label.className = 'IssueLabel';
    label.dataset.name = name;
    label.textContent = name;
    label.style.backgroundColor = background;
    label.style.color = '#ffffff';
    label.style.borderColor = background;
    document.querySelector('.js-issue-labels').append(label);
    return label;
  };
  const flush = async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  };

  return {
    document, window, theme, addLabel, flush,
    start(triggers = TRIGGER_LABELS) {
      controller = observeMergeWarning(document, triggers);
      return controller;
    },
    badges: () => Array.from(document.querySelectorAll('.gdm-warning-labels > span')),
  };
}

test('shows every matching sidebar label with its original colors', (t) => {
  const f = fixture(t);
  const labels = [
    f.addLabel('do not merge', '#a21b53'),
    f.addLabel('do-not-merge', '#d24bda'),
  ];
  f.addLabel('bug', '#d73a4a');
  const button = f.document.querySelector('#merge-button');
  let clicks = 0;
  button.addEventListener('click', () => clicks++);
  f.start();

  assert.deepEqual(f.badges().map((badge) => badge.textContent), TRIGGER_LABELS);
  for (const [index, badge] of f.badges().entries()) {
    const original = f.window.getComputedStyle(labels[index]);
    assert.equal(badge.style.backgroundColor, original.backgroundColor);
    assert.equal(badge.style.color, original.color);
    assert.equal(badge.style.borderColor, original.borderColor);
    assert.equal(badge.tagName, 'SPAN');
    assert.equal(badge.id, '');
  }
  const target = f.document.querySelector('#merge-actions');
  assert.ok(target.classList.contains('gdm-merge-warning'));
  assert.equal(f.window.getComputedStyle(target).outline, '2px solid #cf222e');
  assert.equal(target.previousElementSibling.className, 'gdm-warning-labels');
  assert.equal(f.document.querySelector('#checks').className, '');
  button.click();
  assert.equal(clicks, 1);
  assert.equal(button.disabled, false);
});

test('ignores timeline labels and unchecked label-picker entries', (t) => {
  const f = fixture(t);
  f.addLabel('please do not merge yet');
  f.start();
  assert.equal(f.badges().length, 0);
  assert.equal(f.document.querySelector('.gdm-merge-warning'), null);
});

test('supports the configured list, exact case-insensitive matching and deduplication', (t) => {
  const f = fixture(t);
  f.addLabel('  HOLD  ');
  f.addLabel('hold');
  f.addLabel('do not merge');
  f.start(['hold']);
  assert.deepEqual(f.badges().map((badge) => badge.textContent), ['HOLD']);
});

test('updates when labels are added, removed, renamed or recolored', async (t) => {
  const f = fixture(t);
  f.start();
  const first = f.addLabel('do not merge');
  const second = f.addLabel('do-not-merge');
  await f.flush();
  assert.equal(f.badges().length, 2);

  first.remove();
  second.style.backgroundColor = '#123456';
  second.style.color = '#eeeeee';
  await f.flush();
  assert.equal(f.badges().length, 1);
  assert.equal(f.badges()[0].style.backgroundColor, 'rgb(18, 52, 86)');
  assert.equal(f.badges()[0].style.color, 'rgb(238, 238, 238)');

  second.dataset.name = 'safe to merge';
  second.textContent = 'safe to merge';
  await f.flush();
  assert.equal(f.badges().length, 0);
  assert.equal(f.document.querySelector('.gdm-merge-warning'), null);
});

test('refreshes colors when the browser theme changes', async (t) => {
  const f = fixture(t);
  const label = f.addLabel('do not merge');
  f.document.head.insertAdjacentHTML('beforeend', `
    <style>.IssueLabel { background-color: var(--label-color, #a21b53) !important; }</style>
  `);
  f.start();
  label.style.setProperty('--label-color', '#333333');
  f.theme.dispatchEvent(new f.window.Event('change'));
  await f.flush();
  assert.equal(f.badges()[0].style.backgroundColor, f.window.getComputedStyle(label).backgroundColor);
});

test('reconciles delayed and replaced merge controls without duplicating warnings', async (t) => {
  const f = fixture(t, { markup: '' });
  f.addLabel('do not merge');
  f.start();
  assert.equal(f.badges().length, 0);

  f.document.body.insertAdjacentHTML('beforeend', modernMergeBox);
  await f.flush();
  assert.equal(f.badges().length, 1);
  const oldTarget = f.document.querySelector('#merge-actions');
  oldTarget.outerHTML = '<div id="merge-actions"><button>Rebase and merge</button></div>';
  await f.flush();
  assert.equal(oldTarget.classList.contains('gdm-merge-warning'), false);
  assert.equal(f.document.querySelectorAll('.gdm-warning-labels').length, 1);
  assert.ok(f.document.querySelector('#merge-actions').classList.contains('gdm-merge-warning'));

  f.document.querySelector('[data-testid="mergebox-partial"]').remove();
  await f.flush();
  assert.equal(f.badges().length, 0);
});

test('keeps disabled merge buttons disabled and supports legacy markup', (t) => {
  const f = fixture(t, {
    markup: '<div class="merge-message"><button disabled>Squash and merge</button><p>Instructions</p></div>',
  });
  f.addLabel('do not merge');
  f.start();
  assert.ok(f.document.querySelector('.merge-message').classList.contains('gdm-merge-warning'));
  assert.equal(f.document.querySelector('.merge-message button').disabled, true);
});

test('recognizes merge strategies, confirmations and auto-merge controls', async (t) => {
  for (const action of [
    'Merge pull request', 'Squash and merge', 'Rebase and merge',
    'Enable auto-merge', 'Merge when ready', 'Confirm squash and merge',
    'Confirm rebase and merge', 'Confirm merge', 'Disable auto-merge',
  ]) {
    await t.test(action, (subtest) => {
      const f = fixture(subtest);
      f.addLabel('do not merge');
      f.document.querySelector('#merge-button').textContent = action;
      f.start();
      assert.equal(f.badges().length, 1);
    });
  }
});

test('does not highlight update-branch or ready-for-review controls as merge buttons', (t) => {
  const f = fixture(t);
  f.addLabel('do not merge');
  f.document.querySelector('#merge-button').textContent = 'Ready for review';
  f.start();
  assert.equal(f.badges().length, 0);
});

test('ignores hidden controls and uses visible text even when an aria-label differs', (t) => {
  const f = fixture(t);
  f.addLabel('do not merge');
  const target = f.document.querySelector('#merge-actions');
  target.insertAdjacentHTML('beforebegin',
    '<div style="display:none"><button>Merge pull request</button></div>');
  f.document.querySelector('#merge-button').setAttribute('aria-label', 'Merge changes');
  f.start();
  assert.ok(target.classList.contains('gdm-merge-warning'));
  assert.equal(f.document.querySelectorAll('.gdm-merge-warning').length, 1);
});

test('selects the visible legacy merge area when a hidden form exists', (t) => {
  const f = fixture(t, {
    markup: '<div class="merge-message" hidden><button>Merge pull request</button></div><div class="merge-message" id="visible"><button>Confirm merge</button></div>',
  });
  f.addLabel('do not merge');
  f.start();
  assert.equal(f.document.querySelector('.merge-message[hidden]').classList.contains('gdm-merge-warning'), false);
  assert.ok(f.document.querySelector('#visible').classList.contains('gdm-merge-warning'));
});

test('never decorates outside the mergebox when its button is a direct child', (t) => {
  const f = fixture(t, {
    markup: '<div data-testid="mergebox-partial"><button>Merge pull request</button></div>',
  });
  f.addLabel('do not merge');
  f.start();
  assert.ok(f.document.querySelector('[data-testid="mergebox-partial"]').classList.contains('gdm-merge-warning'));
  assert.equal(f.document.body.classList.contains('gdm-merge-warning'), false);
});

test('handles client-side navigation, non-conversation tabs and cached pages', async (t) => {
  const f = fixture(t, { path: '/issues' });
  f.addLabel('do not merge');
  const controller = f.start();
  assert.equal(f.badges().length, 0);

  f.window.history.pushState({}, '', '/owner/repo/pull/2');
  controller.refresh();
  await f.flush();
  assert.equal(f.badges().length, 1);

  f.document.dispatchEvent(new f.window.Event('turbo:before-cache'));
  assert.equal(f.badges().length, 0);
  f.document.dispatchEvent(new f.window.Event('turbo:load'));
  await f.flush();
  assert.equal(f.badges().length, 1);

  f.window.history.pushState({}, '', '/owner/repo/pull/2/files');
  controller.refresh();
  await f.flush();
  assert.equal(f.badges().length, 0);
  assert.equal(f.document.querySelector('.gdm-merge-warning'), null);
});

test('renders custom label names as text and cleans up on invalidation', async (t) => {
  const f = fixture(t);
  const name = '<img src=x onerror=alert(1)>';
  f.addLabel(name);
  const controller = f.start([name]);
  assert.equal(f.badges()[0].textContent, name);
  assert.equal(f.badges()[0].children.length, 0);
  controller.dispose();
  f.addLabel(name);
  controller.refresh();
  await f.flush();
  assert.equal(f.badges().length, 0);
  assert.equal(f.document.querySelector('.gdm-merge-warning'), null);
});
