import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { DEFAULT_TRIGGER_LABELS } from '../config/trigger-labels.ts';
import { observeMergeWarning, visibleLabelCount } from '../utils/merge-warning.ts';

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
    start(triggers = DEFAULT_TRIGGER_LABELS) {
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
    f.addLabel('Not Ready To Merge', '#0969da'),
  ];
  f.addLabel('bug', '#d73a4a');
  const button = f.document.querySelector('#merge-button');
  let clicks = 0;
  button.addEventListener('click', () => clicks++);
  f.start();

  assert.deepEqual(f.badges().map((badge) => badge.textContent), DEFAULT_TRIGGER_LABELS);
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
  assert.equal(f.window.getComputedStyle(target).outlineOffset, '-2px');
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

test('matches a custom Not Ready To Merge label regardless of case', (t) => {
  const f = fixture(t);
  const label = f.addLabel('not ready to merge', '#0969da');
  f.start(['Not Ready To Merge']);

  assert.deepEqual(f.badges().map((badge) => badge.textContent), ['not ready to merge']);
  assert.equal(f.badges()[0].style.backgroundColor, f.window.getComputedStyle(label).backgroundColor);
  assert.ok(f.document.querySelector('#merge-actions').classList.contains('gdm-merge-warning'));
});

test('updates configured labels live, supports an empty list and ignores updates after disposal', async (t) => {
  const f = fixture(t);
  f.addLabel('do not merge');
  f.addLabel('Not Ready To Merge');
  const controller = f.start();
  assert.deepEqual(f.badges().map((badge) => badge.textContent), ['do not merge']);
  controller.setTriggerLabels(['Not Ready To Merge']);
  await f.flush();
  assert.deepEqual(f.badges().map((badge) => badge.textContent), ['Not Ready To Merge']);
  controller.setTriggerLabels([]);
  await f.flush();
  assert.equal(f.badges().length, 0);
  assert.equal(f.document.querySelector('.gdm-merge-warning'), null);
  controller.setTriggerLabels(DEFAULT_TRIGGER_LABELS);
  await f.flush();
  assert.equal(f.badges().length, 1);
  controller.dispose();
  controller.setTriggerLabels(DEFAULT_TRIGGER_LABELS);
  await f.flush();
  assert.equal(f.badges().length, 0);
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
    'Bypass rules and merge', 'Bypass rules and merge (squash)', 'Bypass rules and merge (rebase)',
    'Confirm bypass rules and merge',
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

test('reserves an ellipsis badge and gap without truncating individual labels', () => {
  assert.equal(visibleLabelCount([60, 60, 60], 188, 4, 28), 3);
  assert.equal(visibleLabelCount([60, 60, 60], 187, 4, 28), 2);
  assert.equal(visibleLabelCount([60, 60, 60], 155, 4, 28), 1);
  assert.equal(visibleLabelCount([60, 60], 92, 4, 28), 1);
  assert.equal(visibleLabelCount([60, 60], 91, 4, 28), 0);
  assert.equal(visibleLabelCount([400], 100, 4, 28), 0);
  assert.equal(visibleLabelCount([], 0, 4, 28), 0);
  assert.doesNotMatch(stylesheet.match(/\.gdm-warning-labels > span \{([^}]*)\}/)?.[1] ?? '', /max-width/);
});

test('hides trailing badges, exposes hidden names and recalculates on resize', async (t) => {
  const f = fixture(t);
  for (const label of ['do not merge', 'do-not-merge', 'Hold']) f.addLabel(label);
  const target = f.document.querySelector('#merge-actions');
  let width = 196;
  target.getBoundingClientRect = () => ({ width });
  const original = f.window.HTMLElement.prototype.getBoundingClientRect;
  f.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.parentElement?.classList.contains('gdm-warning-labels')) {
      return { width: this.classList.contains('gdm-overflow-label') ? 28 : 70 };
    }
    return original.call(this);
  };
  const controller = f.start(['do not merge', 'do-not-merge', 'Hold']);
  const visible = () => f.badges().filter((badge) => !badge.hidden).map((badge) => badge.textContent);
  assert.deepEqual(visible(), ['do not merge', 'do-not-merge', '...']);
  assert.equal(f.document.querySelector('.gdm-overflow-label').title, 'Hold');
  assert.equal(f.document.querySelector('.gdm-warning-labels').style.width, '180px');
  width = 100;
  f.window.dispatchEvent(new f.window.Event('resize'));
  await f.flush();
  assert.deepEqual(visible(), ['...']);
  assert.match(f.document.querySelector('.gdm-overflow-label').getAttribute('aria-label'), /Hold/);
  width = 400;
  f.window.dispatchEvent(new f.window.Event('resize'));
  await f.flush();
  assert.deepEqual(visible(), ['do not merge', 'do-not-merge', 'Hold']);
  assert.equal(f.document.querySelector('.gdm-overflow-label'), null);
  controller.dispose();
  assert.equal(f.document.querySelector('.gdm-warning-labels'), null);
});

test('optional blocking disables merge actions, shows an accessible stop sign and intercepts activation', async (t) => {
  const f = fixture(t);
  f.addLabel('do not merge');
  const button = f.document.querySelector('#merge-button');
  button.title = 'Original GitHub hint';
  let clicks = 0, keys = 0;
  button.addEventListener('click', () => clicks++);
  button.addEventListener('keydown', () => keys++);
  const controller = f.start();
  controller.setBlockMerging(true);
  await f.flush();
  assert.equal(button.disabled, true);
  assert.equal(button.title, 'Original GitHub hint', 'only the stop sign shows a tooltip');
  const marker = f.document.querySelector('.gdm-merge-stop');
  assert.equal(marker.getAttribute('role'), 'note');
  assert.equal(marker.querySelector('[role=tooltip]'), null, 'no tooltip, the reminder is visible text');
  assert.equal(marker.querySelector('.gdm-stop-text').textContent,
    'Remove all monitored do-not-merge labels from this PR before merging.');
  assert.ok(button.compareDocumentPosition(marker) & f.window.Node.DOCUMENT_POSITION_PRECEDING);
  assert.equal(button.contains(marker), false);
  button.click();
  const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  button.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(clicks, 0);
  for (const key of ['Enter', ' ']) {
    button.dispatchEvent(new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
  assert.equal(keys, 0);
  controller.setBlockMerging(false);
  await f.flush();
  assert.equal(button.disabled, false);
  assert.equal(button.title, 'Original GitHub hint');
  assert.equal(f.document.querySelector('.gdm-merge-stop'), null);
  button.click();
  assert.equal(clicks, 1);
});

test('places one stop notice above the row holding GitHub split button groups', async (t) => {
  const f = fixture(t, {
    markup: `<div data-testid="mergebox-partial"><section>Checks</section><div id="box"><div id="row">
      <div class="prc-ButtonGroup-ButtonGroup-vFUrY"><div><button id="merge-button">Bypass rules and merge</button></div>
      <div><button aria-label="Select merge method"></button></div></div>
      <span>You can also merge this with the command line.</span></div></div></div>`,
  });
  f.addLabel('do not merge');
  const controller = f.start();
  controller.setBlockMerging(true);
  await f.flush();
  assert.equal(f.document.querySelectorAll('.gdm-merge-stop').length, 1);
  assert.equal(f.document.querySelector('#row').previousElementSibling.className, 'gdm-merge-stop');
  assert.equal(f.document.querySelector('#merge-button').disabled, true);
});

test('blocks confirmations and enabling auto-merge but never cancellation or unrelated buttons', async (t) => {
  const f = fixture(t, {
    markup: `<div class="merge-message">${[
      'Merge pull request', 'Confirm squash and merge', 'Confirm rebase and merge',
      'Enable auto-merge', 'Merge when ready', 'Disable auto-merge', 'Cancel auto-merge', 'Update branch',
    ].map((text) => `<button>${text}</button>`).join('')}</div>`,
  });
  f.addLabel('do not merge');
  const controller = f.start();
  controller.setBlockMerging(true);
  await f.flush();
  assert.deepEqual(Array.from(f.document.querySelectorAll('button'), (button) => button.disabled),
    [true, true, true, true, true, false, false, false]);
  controller.setTriggerLabels([]);
  await f.flush();
  assert.equal(f.document.querySelectorAll('button:disabled').length, 0);
});

test('preserves GitHub disabled updates while blocked and restores them on label removal', async (t) => {
  const f = fixture(t);
  const first = f.addLabel('do not merge');
  const second = f.addLabel('do-not-merge');
  const button = f.document.querySelector('#merge-button');
  const controller = f.start();
  controller.setBlockMerging(true);
  await f.flush();
  button.disabled = true;
  button.title = 'Checks are now failing';
  await f.flush();
  first.remove();
  await f.flush();
  assert.equal(button.disabled, true);
  assert.equal(f.document.querySelectorAll('.gdm-merge-stop').length, 1);
  second.remove();
  await f.flush();
  assert.equal(button.disabled, true, 'do not override GitHub disabling an already blocked button');
  assert.equal(button.title, 'Checks are now failing');
  f.addLabel('do not merge');
  await f.flush();
  button.disabled = false;
  await f.flush();
  assert.equal(button.disabled, true, 'reapply blocking after GitHub enables the button');
  controller.dispose();
  assert.equal(button.disabled, false, 'restore the latest GitHub state');
  assert.equal(button.hasAttribute('data-gdm-blocked'), false);
});

test('cleans blocked buttons on replacement, cached navigation and disposal', async (t) => {
  const f = fixture(t);
  f.addLabel('do not merge');
  const controller = f.start();
  controller.setBlockMerging(true);
  await f.flush();
  const old = f.document.querySelector('#merge-button');
  old.outerHTML = '<button id="replacement" disabled>Confirm merge</button>';
  await f.flush();
  assert.equal(old.disabled, false);
  assert.equal(f.document.querySelectorAll('.gdm-merge-stop').length, 1);
  const replacement = f.document.querySelector('#replacement');
  f.document.dispatchEvent(new f.window.Event('turbo:before-cache'));
  assert.equal(replacement.disabled, true);
  assert.equal(f.document.querySelector('.gdm-merge-stop'), null);
  f.document.dispatchEvent(new f.window.Event('turbo:load'));
  await f.flush();
  assert.equal(f.document.querySelectorAll('.gdm-merge-stop').length, 1);
  f.window.history.pushState({}, '', '/owner/repo/pull/1/files');
  controller.refresh();
  await f.flush();
  assert.equal(f.document.querySelector('.gdm-merge-stop'), null);
  assert.equal(replacement.disabled, true);
  controller.dispose();
  controller.setBlockMerging(true);
  assert.equal(f.document.querySelector('.gdm-merge-stop'), null);
});
