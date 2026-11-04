const WARNING_CLASS = 'gdm-merge-warning';
const LABELS_CLASS = 'gdm-warning-labels';
const MERGE_ACTION = /^(?:merge pull request|squash and merge|rebase and merge|enable auto-merge|merge when ready|confirm merge|confirm squash|confirm rebase|disable auto-merge|cancel auto-merge)\b/i;

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
    !isHidden(candidate) &&
    [candidate.getAttribute('aria-label'), candidate.textContent].some((name) =>
      MERGE_ACTION.test((name ?? '')
        .trim()
        .replace(/\s+/g, ' ')),
    ),
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
): { refresh: () => void; setTriggerLabels: (labels: readonly string[]) => void; dispose: () => void } {
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

  const clear = () => {
    resizeObserver?.disconnect();
    decoration?.target.classList.remove(WARNING_CLASS);
    decoration?.labels.remove();
    decoration = undefined;
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
  };

  const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(() => schedule()) : undefined;
  const observer = new view.MutationObserver(() => schedule());
  const observe = () => observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'class', 'style', 'data-name', 'data-testid', 'aria-label', 'hidden',
      'data-color-mode', 'data-light-theme', 'data-dark-theme',
    ],
  });
  const update = () => {
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
    dispose() {
      disposed = true;
      observer.disconnect();
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      document.removeEventListener('turbo:before-cache', beforeCache);
      document.removeEventListener('turbo:load', resume);
      view.removeEventListener('popstate', resume);
      view.removeEventListener('resize', schedule);
      theme.removeEventListener('change', schedule);
      clear();
    },
  };
}
