const WARNING_CLASS = 'gdm-merge-warning';
const LABELS_CLASS = 'gdm-warning-labels';
const MERGE_ACTION = /^(?:merge pull request|squash and merge|rebase and merge|enable auto-merge|merge when ready|confirm merge|confirm squash|confirm rebase|disable auto-merge|cancel auto-merge)\b/i;

function normalize(name: string): string {
  return name.trim().toLowerCase();
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
): { refresh: () => void; dispose: () => void } {
  const view = document.defaultView;
  if (!view) throw new Error('Merge warnings require a browser document.');

  const triggers = new Set(triggerLabels.map(normalize).filter(Boolean));
  let decoration: {
    target: HTMLElement;
    labels: HTMLDivElement;
    signature: string;
  } | undefined;
  let frame: number | undefined;
  let disposed = false;

  const clear = () => {
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
  };

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
  theme.addEventListener('change', schedule);
  update();

  return {
    refresh: resume,
    dispose() {
      disposed = true;
      observer.disconnect();
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      document.removeEventListener('turbo:before-cache', beforeCache);
      document.removeEventListener('turbo:load', resume);
      view.removeEventListener('popstate', resume);
      theme.removeEventListener('change', schedule);
      clear();
    },
  };
}
