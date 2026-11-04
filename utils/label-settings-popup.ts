import { DEFAULT_TRIGGER_LABELS } from '../config/trigger-labels.ts';
import type { createLabelSettings } from './label-settings.ts';

export function mountLabelSettings(
  document: Document,
  settings: ReturnType<typeof createLabelSettings>,
): () => void {
  return mountListSettings(document, settings, {
    prefix: 'label',
    defaults: DEFAULT_TRIGGER_LABELS,
    savedMessage: 'Saved. Changes apply to open GitHub tabs.',
  });
}

export function mountListSettings(
  document: Document,
  settings: ReturnType<typeof createLabelSettings>,
  options: {
    prefix: 'label' | 'site';
    defaults: readonly string[];
    savedMessage: string;
    requestAccess?: (values: readonly string[]) => Promise<void>;
    hasAccess?: (value: string) => Promise<boolean>;
  },
): () => void {
  function element<T extends HTMLElement>(selector: string): T {
    const result = document.querySelector<T>(selector);
    if (!result) throw new Error(`Missing popup element: ${selector}`);
    return result;
  }
  const prefix = options.prefix;
  const form = element<HTMLFormElement>(`#${prefix}-form`);
  const controls = element<HTMLFieldSetElement>(`#${prefix}-controls`);
  const input = element<HTMLInputElement>(`#${prefix}-name`);
  const list = element<HTMLUListElement>(`#${prefix}-list`);
  const empty = element(`#empty-${prefix}s`);
  const reset = element<HTMLButtonElement>(prefix === 'label' ? '#restore-defaults' : '#restore-sites');
  const status = element(prefix === 'label' ? '#settings-status' : '#site-status');
  const errorMessage = element(prefix === 'label' ? '#settings-error' : '#site-error');
  const retry = element<HTMLButtonElement>(prefix === 'label' ? '#retry-settings' : '#retry-sites');
  let labels: readonly string[] | undefined;
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
      remove.className = `remove-${prefix}`;
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${label}`);
      remove.addEventListener('click', () => {
        void save((labels ?? []).filter((name) => name !== label));
      });
      item.append(name, remove);
      if (options.hasAccess && options.requestAccess) {
        const grant = document.createElement('button');
        grant.type = 'button';
        grant.className = 'secondary';
        grant.textContent = 'Allow access';
        grant.hidden = true;
        grant.addEventListener('click', () => { void save(labels ?? []); });
        item.append(grant);
        void options.hasAccess(label).then(
          (allowed) => { if (!disposed && item.isConnected) grant.hidden = allowed; },
          (error: unknown) => { if (!disposed && item.isConnected) showError(error); },
        );
      }
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
      // Start saving before the permission prompt: the prompt can close the popup and drop later work.
      const saved = settings.save(next);
      const access = options.requestAccess?.(next);
      access?.catch(() => undefined);
      await saved;
      if (!disposed && adding) input.value = '';
      await access;
      if (disposed) return;
      status.textContent = options.savedMessage;
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
  const restore = () => { void save(options.defaults); };
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
