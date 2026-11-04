import type { createMergeSettings } from './merge-settings.ts';

export function mountMergeSettings(document: Document, settings: ReturnType<typeof createMergeSettings>) {
  const controls = document.querySelector<HTMLFieldSetElement>('#merge-controls');
  const checkbox = document.querySelector<HTMLInputElement>('#block-merging');
  const status = document.querySelector<HTMLElement>('#merge-status');
  const errorMessage = document.querySelector<HTMLElement>('#merge-error');
  const retry = document.querySelector<HTMLButtonElement>('#retry-merge-settings');
  if (!controls || !checkbox || !status || !errorMessage || !retry) {
    throw new Error('Missing merge-blocking popup controls.');
  }
  let value: boolean | undefined;
  let saving = false;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const render = () => {
    controls.disabled = saving || value === undefined;
    checkbox.checked = value ?? false;
  };
  const showError = (error: unknown) => {
    status.textContent = '';
    errorMessage.textContent = error instanceof Error ? error.message : String(error);
    errorMessage.hidden = false;
  };
  const load = () => {
    unsubscribe?.();
    value = undefined;
    retry.hidden = true;
    errorMessage.hidden = true;
    status.textContent = 'Loading settings...';
    render();
    unsubscribe = settings.subscribe(
      (next) => {
        value = next;
        errorMessage.hidden = true;
        retry.hidden = true;
        if (!saving) status.textContent = 'Settings loaded.';
        render();
      },
      (error) => {
        value = undefined;
        showError(error);
        retry.hidden = false;
        render();
      },
    );
  };
  const change = async () => {
    if (disposed || saving || value === undefined) return;
    const next = checkbox.checked;
    saving = true;
    errorMessage.hidden = true;
    status.textContent = 'Saving...';
    render();
    try {
      await settings.save(next);
      if (!disposed) status.textContent = 'Saved. Changes apply to open GitHub tabs.';
    } catch (error) {
      if (!disposed) showError(error);
    } finally {
      saving = false;
      if (!disposed) render();
    }
  };
  const onChange = () => { void change(); };
  checkbox.addEventListener('change', onChange);
  retry.addEventListener('click', load);
  load();
  return () => {
    disposed = true;
    unsubscribe?.();
    checkbox.removeEventListener('change', onChange);
    retry.removeEventListener('click', load);
  };
}
