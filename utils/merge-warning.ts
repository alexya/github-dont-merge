const WARNING_CLASS = 'gdm-merge-warning';
const LABELS_CLASS = 'gdm-warning-labels';
const MERGE_ACTION = /^(?:merge pull request|squash and merge|rebase and merge|enable auto-merge|merge when ready|confirm merge|confirm squash|confirm rebase|(?:confirm )?bypass rules and merge|disable auto-merge|cancel auto-merge)\b/i;
const CANCEL_AUTO_MERGE = /^(?:disable|cancel) auto-merge\b/i;
const BLOCKED_MESSAGE = 'Remove all monitored do-not-merge labels from this PR before merging.';

function isMergeAction(button: HTMLButtonElement, blocking = false): boolean {
  return [button.getAttribute('aria-label'), button.textContent].some((value) => {
    const name = (value ?? '').trim().replace(/\s+/g, ' ');
    return MERGE_ACTION.test(name) && (!blocking || !CANCEL_AUTO_MERGE.test(name));
  });
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function visibleLabelCount(
  widths: readonly number[], available: number, gap: number, overflowWidth: number,
): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap;
  if (total <= available) return widths.length;
  let used = 0;
  let count = 0;
  for (const width of widths) {
    if (used + width + gap + overflowWidth > available) break;
    used += width + gap;
    count++;
  }
  return count;
}

function fitLabels(target: HTMLElement, row: HTMLDivElement, view: Window) {
  row.querySelector('.gdm-overflow-label')?.remove();
  const badges = Array.from(row.querySelectorAll('span'));
  badges.forEach((badge) => { badge.hidden = false; });
  const available = Math.max(0, target.getBoundingClientRect().width - 16);
  row.style.width = `${available}px`;
  if (!available) return;

  const more = row.ownerDocument.createElement('span');
  more.className = 'gdm-overflow-label';
  more.textContent = '...';
  more.tabIndex = 0;
  row.append(more);
  const count = visibleLabelCount(
    badges.map((badge) => badge.getBoundingClientRect().width),
    available,
    Number.parseFloat(view.getComputedStyle(row).columnGap) || 0,
    more.getBoundingClientRect().width,
  );
  if (count === badges.length) {
    more.remove();
    return;
  }
  const hidden = badges.slice(count);
  hidden.forEach((badge) => { badge.hidden = true; });
  const names = hidden.map((badge) => badge.textContent).join(', ');
  more.title = names;
  more.setAttribute('aria-label', `More labels warning against merging: ${names}`);
}

function isHidden(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true') return true;
    const style = view?.getComputedStyle(ancestor);
    if (style?.display === 'none' || style?.visibility === 'hidden') return true;
  }
  return false;
}

function findMergeArea(document: Document): HTMLElement | null {
  const legacyArea = Array.from(
    document.querySelectorAll<HTMLElement>('.merge-message'),
  ).find((area) => !isHidden(area));
  if (legacyArea) return legacyArea;

  const root = document.querySelector<HTMLElement>('[data-testid="mergebox-partial"]');
  if (!root) return null;

  const button = Array.from(root.querySelectorAll('button')).find((candidate) =>
    !isHidden(candidate) && isMergeAction(candidate),
  );
  if (!button) return null;

  let area = button.parentElement;
  // Keep the frame below the status sections without reparenting React's controls.
  while (area && area !== root && area.parentElement && area.parentElement !== root) {
    if (area.parentElement.querySelector('section')) break;
    area = area.parentElement;
  }
  return area;
}

export function observeMergeWarning(
  document: Document,
  triggerLabels: readonly string[],
): {
  refresh: () => void;
  setTriggerLabels: (labels: readonly string[]) => void;
  setBlockMerging: (enabled: boolean) => void;
  dispose: () => void;
} {
  const view = document.defaultView;
  if (!view) throw new Error('Merge warnings require a browser document.');

  let triggers = new Set(triggerLabels.map(normalize).filter(Boolean));
  let decoration: {
    target: HTMLElement;
    labels: HTMLDivElement;
    signature: string;
  } | undefined;
  let frame: number | undefined;
  let disposed = false;
  let blockMerging = false;
  const blocked = new Map<HTMLButtonElement, {
    disabled: boolean;
    marker: HTMLDivElement;
  }>();
  const releaseButton = (button: HTMLButtonElement) => {
    const state = blocked.get(button);
    if (!state) return;
    button.disabled = state.disabled;
    button.removeAttribute('data-gdm-blocked');
    state.marker.remove();
    blocked.delete(button);
  };
  const rememberButtonChanges = (records: MutationRecord[]) => {
    for (const record of records) {
      if (!(record.target instanceof view.HTMLButtonElement)) continue;
      const state = blocked.get(record.target);
      if (!state) continue;
      if (record.attributeName === 'disabled') state.disabled = record.target.disabled;
    }
  };
  const renderBlocking = (target: HTMLElement) => {
    const buttons = blockMerging
      ? Array.from(target.querySelectorAll('button')).filter((button) => !isHidden(button) && isMergeAction(button, true))
      : [];
    for (const button of blocked.keys()) {
      if (!buttons.includes(button)) releaseButton(button);
    }
    const anchors = new Set<Element>();
    for (const button of buttons) {
      let state = blocked.get(button);
      if (!state) {
        const marker = document.createElement('div');
        marker.className = 'gdm-merge-stop';
        marker.setAttribute('role', 'note');
        const sign = document.createElement('span');
        sign.className = 'gdm-stop-sign';
        sign.textContent = 'STOP';
        sign.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'gdm-stop-text';
        text.textContent = BLOCKED_MESSAGE;
        marker.append(sign, text);
        state = { disabled: button.disabled, marker };
        blocked.set(button, state);
      }
      button.disabled = true;
      button.dataset.gdmBlocked = '';
      // Show the notice on its own line below the row that holds the merge button group.
      const group = button.closest('.BtnGroup, [class*="ButtonGroup-ButtonGroup"]');
      let anchor: Element = group && target.contains(group) ? group : button;
      if (anchor.parentElement && anchor.parentElement !== target && target.contains(anchor.parentElement)) {
        anchor = anchor.parentElement;
      }
      if (anchors.has(anchor)) {
        state.marker.remove();
        continue;
      }
      anchors.add(anchor);
      if (anchor.nextElementSibling !== state.marker) anchor.after(state.marker);
    }
  };

  const clear = () => {
    resizeObserver?.disconnect();
    decoration?.target.classList.remove(WARNING_CLASS);
    decoration?.labels.remove();
    decoration = undefined;
    for (const button of blocked.keys()) releaseButton(button);
  };

  const render = () => {
    if (!/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(view.location.pathname)) {
      clear();
      return;
    }

    const seen = new Set<string>();
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>('.js-issue-labels .IssueLabel'),
    ).flatMap((source) => {
      const name = (source.dataset.name ?? source.textContent ?? '').trim();
      const key = normalize(name);
      if (!triggers.has(key) || seen.has(key)) return [];
      seen.add(key);
      const style = view.getComputedStyle(source);
      return [{
        name,
        background: style.backgroundColor,
        color: style.color,
        border: style.borderColor,
      }];
    });
    const target = labels.length ? findMergeArea(document) : null;

    if (decoration?.target !== target) clear();
    if (!target || !labels.length) return;

    if (!decoration) {
      const row = document.createElement('div');
      row.className = LABELS_CLASS;
      row.setAttribute('role', 'note');
      row.setAttribute('aria-label', 'Labels warning against merging');
      decoration = { target, labels: row, signature: '' };
      resizeObserver?.observe(target);
    }

    if (!target.classList.contains(WARNING_CLASS)) {
      target.classList.add(WARNING_CLASS);
    }
    if (decoration.labels.nextElementSibling !== target) {
      target.before(decoration.labels);
    }

    const signature = JSON.stringify(labels);
    if (decoration.signature !== signature) {
      decoration.labels.replaceChildren(...labels.map((label) => {
        const badge = document.createElement('span');
        badge.textContent = label.name;
        badge.title = label.name;
        badge.style.backgroundColor = label.background;
        badge.style.color = label.color;
        badge.style.borderColor = label.border;
        return badge;
      }));
      decoration.signature = signature;
    }
    fitLabels(target, decoration.labels, view);
    renderBlocking(target);
  };

  const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(() => schedule()) : undefined;
  const observer = new view.MutationObserver((records) => {
    rememberButtonChanges(records);
    schedule();
  });
  const observe = () => observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'class', 'style', 'data-name', 'data-testid', 'aria-label', 'hidden',
      'data-color-mode', 'data-light-theme', 'data-dark-theme',
      'disabled',
    ],
  });
  const update = () => {
    rememberButtonChanges(observer.takeRecords());
    observer.disconnect();
    try {
      render();
    } finally {
      if (!disposed) observe();
    }
  };
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      update();
    });
  };
  const beforeCache = () => {
    rememberButtonChanges(observer.takeRecords());
    observer.disconnect();
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    clear();
  };
  const resume = () => {
    if (disposed) return;
    observe();
    schedule();
  };
  const theme = view.matchMedia('(prefers-color-scheme: dark)');
  const preventMerge = (event: Event) => {
    const button = event.target instanceof view.Element ? event.target.closest('button') : null;
    if (!button || !blocked.has(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const preventMergeKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') preventMerge(event);
  };

  document.addEventListener('click', preventMerge, true);
  document.addEventListener('keydown', preventMergeKey, true);
  document.addEventListener('turbo:before-cache', beforeCache);
  document.addEventListener('turbo:load', resume);
  view.addEventListener('popstate', resume);
  view.addEventListener('resize', schedule);
  theme.addEventListener('change', schedule);
  update();

  return {
    refresh: resume,
    setTriggerLabels(labels) {
      if (disposed) return;
      triggers = new Set(labels.map(normalize).filter(Boolean));
      schedule();
    },
    setBlockMerging(enabled) {
      if (disposed) return;
      blockMerging = enabled;
      schedule();
    },
    dispose() {
      disposed = true;
      rememberButtonChanges(observer.takeRecords());
      observer.disconnect();
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      document.removeEventListener('turbo:before-cache', beforeCache);
      document.removeEventListener('turbo:load', resume);
      view.removeEventListener('popstate', resume);
      view.removeEventListener('resize', schedule);
      theme.removeEventListener('change', schedule);
      document.removeEventListener('click', preventMerge, true);
      document.removeEventListener('keydown', preventMergeKey, true);
      clear();
    },
  };
}
