export type StatusState = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export const SAVED_STATUS_MS = 3000;

const LABELS: Record<Exclude<StatusState, 'idle'>, string> = {
  error: 'Error',
  saving: 'Saving...',
  loading: 'Loading...',
  saved: 'Saved',
};
const PRIORITY: Exclude<StatusState, 'idle'>[] = ['error', 'saving', 'loading', 'saved'];
export type StatusReporter = {
  set(state: StatusState): void;
  /** Data arrived: clear Loading/Error but keep a pending Saving/Saved from this section's own write. */
  settle(): void;
};

const badges = new WeakMap<Document, (initial: StatusState) => StatusReporter>();

/** Returns a reporter for one popup section; all sections share the single `#popup-status` badge. */
export function statusReporter(document: Document, initial: StatusState = 'idle'): StatusReporter {
  let create = badges.get(document);
  if (!create) {
    const badge = document.querySelector<HTMLElement>('#popup-status');
    if (!badge) throw new Error('Missing popup element: #popup-status');
    const view = document.defaultView;
    const states = new Set<{ state: StatusState }>();
    const render = () => {
      const current = PRIORITY.find((state) => [...states].some((source) => source.state === state));
      badge.hidden = !current;
      badge.textContent = current ? LABELS[current] : '';
      badge.dataset.state = current ?? 'idle';
    };
    create = (start) => {
      const source = { state: start };
      let timer: ReturnType<typeof setTimeout> | undefined;
      states.add(source);
      render();
      const set = (state: StatusState) => {
        if (timer !== undefined) (view ?? globalThis).clearTimeout(timer);
        timer = undefined;
        source.state = state;
        if (state === 'saved') {
          timer = (view ?? globalThis).setTimeout(() => {
            timer = undefined;
            source.state = 'idle';
            render();
          }, SAVED_STATUS_MS);
        }
        render();
      };
      return {
        set,
        settle() {
          if (source.state === 'loading' || source.state === 'error') set('idle');
        },
      };
    };
    badges.set(document, create);
  }
  return create(initial);
}
