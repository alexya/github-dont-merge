import type { createMergeSettings } from './merge-settings.ts';
import { statusReporter } from './popup-status.ts';

export function mountMergeSettings(document: Document, settings: ReturnType<typeof createMergeSettings>) {
  const controls = document.querySelector<HTMLFieldSetElement>('#merge-controls');
  const checkbox = document.querySelector<HTMLInputElement>('#block-merging');
  const errorMessage = document.querySelector<HTMLElement>('#merge-error');
  const retry = document.querySelector<HTMLButtonElement>('#retry-merge-settings');
  if (!controls || !checkbox || !errorMessage || !retry) {
    throw new Error('Missing merge-blocking popup controls.');
  }
  let value: boolean | undefined;
  let saving = false;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const report = statusReporter(document, 'loading');
  const render = () => {
    controls.disabled = saving || value === undefined;
    checkbox.checked = value ?? false;
  };
  const showError = (error: unknown) => {
    report.set('error');
    errorMessage.textContent = error instanceof Error ? error.message : String(error);
    errorMessage.hidden = false;
  };
  const load = () => {
    unsubscribe?.();
    value = undefined;
    retry.hidden = true;
    errorMessage.hidden = true;
    report.set('loading');
    render();
    unsubscribe = settings.subscribe(
      (next) => {
        value = next;
        errorMessage.hidden = true;
        retry.hidden = true;
        report.settle();
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
    report.set('saving');
    render();
    try {
      await settings.save(next);
      if (!disposed) report.set('saved');
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
    report.set('idle');
    checkbox.removeEventListener('change', onChange);
    retry.removeEventListener('click', load);
  };
}
