import { DEFAULT_TRIGGER_LABELS } from '../config/trigger-labels.ts';
import type { createLabelSettings } from './label-settings.ts';

export function mountLabelSettings(
  document: Document,
  settings: ReturnType<typeof createLabelSettings>,
): () => void {
  function element<T extends HTMLElement>(selector: string): T {
    const result = document.querySelector<T>(selector);
    if (!result) throw new Error(`Missing popup element: ${selector}`);
    return result;
  }
  const form = element<HTMLFormElement>('#label-form');
  const controls = element<HTMLFieldSetElement>('#label-controls');
  const input = element<HTMLInputElement>('#label-name');
  const list = element<HTMLUListElement>('#label-list');
  const empty = element('#empty-labels');
  const reset = element<HTMLButtonElement>('#restore-defaults');
  const status = element('#settings-status');
  const errorMessage = element('#settings-error');
  const retry = element<HTMLButtonElement>('#retry-settings');
  let labels: string[] | undefined;
  let saving = false;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  const render = () => {
    controls.disabled = saving || labels === undefined;
    empty.hidden = labels === undefined || labels.length > 0;
    list.replaceChildren(...(labels ?? []).map((label) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = label;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-label';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${label}`);
      remove.addEventListener('click', () => {
        void save((labels ?? []).filter((name) => name !== label));
      });
      item.append(name, remove);
      return item;
    }));
  };
  const showError = (error: unknown) => {
    status.textContent = '';
    errorMessage.textContent = error instanceof Error ? error.message : String(error);
    errorMessage.hidden = false;
  };
  const save = async (next: readonly string[], adding = false) => {
    if (disposed || saving || labels === undefined) return;
    saving = true;
    errorMessage.hidden = true;
    status.textContent = 'Saving...';
    render();
    try {
      await settings.save(next);
      if (disposed) return;
      if (adding) input.value = '';
      status.textContent = 'Saved. Changes apply to open GitHub tabs.';
    } catch (error) {
      if (!disposed) showError(error);
    } finally {
      saving = false;
      if (!disposed) {
        render();
        if (adding) input.focus();
      }
    }
  };
  const load = () => {
    unsubscribe?.();
    labels = undefined;
    retry.hidden = true;
    errorMessage.hidden = true;
    status.textContent = 'Loading settings...';
    render();
    unsubscribe = settings.subscribe(
      (next) => {
        labels = next;
        errorMessage.hidden = true;
        retry.hidden = true;
        if (!saving) status.textContent = 'Settings loaded.';
        render();
      },
      (error) => {
        labels = undefined;
        showError(error);
        retry.hidden = false;
        render();
      },
    );
  };
  const submit = (event: Event) => {
    event.preventDefault();
    if (labels !== undefined) void save([...labels, input.value], true);
  };
  const restore = () => { void save(DEFAULT_TRIGGER_LABELS); };
  form.addEventListener('submit', submit);
  reset.addEventListener('click', restore);
  retry.addEventListener('click', load);
  load();

  return () => {
    disposed = true;
    unsubscribe?.();
    form.removeEventListener('submit', submit);
    reset.removeEventListener('click', restore);
    retry.removeEventListener('click', load);
  };
}
