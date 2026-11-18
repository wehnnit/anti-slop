import { toast } from '../ui.js';
import { api } from '../api.js';
import type { ModelEntry, ProviderRecord } from '../api.js';
import {
  button,
  el,
  iconButton,
  input,
  linkButton,
  micro,
  monoInput,
  sectionHead,
  select,
} from './shared.js';
import { PRESETS } from './presets.js';
import { addMemberButton, memberControls } from './team-member.js';
import type { TeamData } from './team-data.js';

export function directApis(data: TeamData, refresh: () => void): HTMLElement {
  const blocks = data.providers.map((provider) =>
    providerBlock(data, provider, data.models.filter((model) => model.providerId === provider.id), refresh),
  );

  return el(
    'div',
    { class: 'team-half team-half--api' },
    sectionHead('Direct APIs', 'HTTP endpoints. Model ids are typed by you, never fetched.'),
    data.providers.length
      ? el('div', { class: 'team-providers' }, ...blocks)
      : el(
          'p',
          { class: 'team-void' },
          'No endpoints yet. Authorize a hosted provider, a proxy, or a local server that speaks the OpenAI or Anthropic shape.',
        ),
    providerForm(refresh),
    presetList(),
  );
}

function providerBlock(data: TeamData, provider: ProviderRecord, models: ModelEntry[], refresh: () => void): HTMLElement {
  const result = el('p', { class: 'team-test', 'aria-live': 'polite' });
  const testButton = button('Test connection', async () => {
    testButton.disabled = true;
    result.dataset.tone = 'pending';
    result.textContent = 'Calling the endpoint';
    try {
      const probe = await api.testProvider(provider.id, models[0] ? { modelId: models[0].modelId } : {});
      report(result, probe.ok, probe.ms, probe.status, probe.message);
    } catch (err) {
      result.dataset.tone = 'error';
      result.textContent = err instanceof Error ? err.message : 'The test could not run.';
    } finally {
      testButton.disabled = false;
    }
  });

  const remove = async (): Promise<void> => {
    try {
      await api.deleteProvider(provider.id);
      toast('Provider removed.', 'ok');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove the provider.', 'error');
    }
  };

  return el(
    'article',
    { class: 'team-provider' },
    el(
      'header',
      { class: 'team-provider-head' },
      el(
        'div',
        { class: 'team-provider-id' },
        el('h3', { class: 'team-provider-label' }, provider.label),
        el('p', { class: 'team-provider-url' }, provider.baseUrl),
        el(
          'p',
          { class: 'team-provider-meta' },
          provider.flavor,
          separator(),
          provider.hasKey ? 'key stored' : 'no key',
          separator(),
          `${models.length} ${models.length === 1 ? 'model' : 'models'}`,
        ),
      ),
      el(
        'div',
        { class: 'team-provider-actions' },
        testButton,
        iconButton('Remove provider', 'M5 5l6 6M11 5l-6 6', () => void remove(), { variant: 'danger' }),
      ),
    ),
    result,
    models.length
      ? el('ul', { class: 'team-models' }, ...models.map((model) => modelRow(data, provider, model, refresh)))
      : el('p', { class: 'team-void team-void--small' }, 'No model ids yet. Type one below exactly as the endpoint names it.'),
    modelForm(provider.id, refresh),
  );
}

function modelRow(data: TeamData, provider: ProviderRecord, model: ModelEntry, refresh: () => void): HTMLElement {
  const assignment = data.assignments.find(
    (item) => item.source.kind === 'api' && item.source.modelEntryId === model.id,
  );

  const toggle = async (): Promise<void> => {
    try {
      await api.updateModel(model.id, { enabled: !model.enabled });
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the model.', 'error');
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await api.deleteModel(model.id);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove the model.', 'error');
    }
  };

  return el(
    'li',
    { class: `team-model${model.enabled ? '' : ' team-model--off'}` },
    el(
      'div',
      { class: 'team-model-id' },
      el('span', { class: 'team-model-state', 'aria-hidden': 'true' }, model.enabled ? '\u25aa' : '\u25ab'),
      el('code', { class: 'team-model-code' }, model.modelId),
      model.contextHint ? el('span', { class: 'team-model-hint' }, `${Math.round(model.contextHint / 1000)}k`) : null,
    ),
    assignment
      ? memberControls(assignment, refresh)
      : el(
          'div',
          { class: 'team-model-unassigned' },
          el('span', { class: 'team-model-note' }, 'Not on the team'),
          addMemberButton(data.assignments, model.label || provider.label, { kind: 'api', modelEntryId: model.id }, refresh),
        ),
    el(
      'div',
      { class: 'team-model-actions' },
      linkButton(model.enabled ? 'Disable' : 'Enable', () => void toggle()),
      iconButton('Remove model', 'M5 5l6 6M11 5l-6 6', () => void remove(), { variant: 'danger' }),
    ),
  );
}

function modelForm(providerId: string, refresh: () => void): HTMLElement {
  const modelId = monoInput({ placeholder: 'vendor/model-id', 'aria-label': 'Model id' });
  const label = input({ placeholder: 'Label (optional)', 'aria-label': 'Model label' });

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const id = modelId.value.trim();
    if (!id) {
      toast('Type the model id exactly as the endpoint expects it.', 'error');
      modelId.focus();
      return;
    }
    try {
      await api.createModel({ providerId, modelId: id, label: label.value.trim() || id });
      toast('Model added.', 'ok');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the model.', 'error');
    }
  };

  return el(
    'form',
    { class: 'team-model-form', 'on:submit': (event: Event) => void submit(event) },
    modelId,
    label,
    button('Add model', () => undefined, { type: 'submit' }),
  );
}

function providerForm(refresh: () => void): HTMLElement {
  const label = input({ placeholder: 'Label', 'aria-label': 'Provider label' });
  const baseUrl = input({ placeholder: 'https://api.example.com/v1', 'aria-label': 'Base URL' });
  const apiKey = el('input', {
    type: 'password',
    class: 'input',
    autocomplete: 'off',
    placeholder: 'API key (optional)',
    'aria-label': 'API key',
  });
  const flavor = select(
    [
      { value: 'openai', label: 'OpenAI-compatible' },
      { value: 'anthropic', label: 'Anthropic messages' },
    ],
    { 'aria-label': 'API shape' },
  );
  const status = el('p', { class: 'team-test', 'aria-live': 'polite' });

  const testButton = button('Test connection', async () => {
    if (!baseUrl.value.trim()) {
      toast('Enter a base URL first.', 'error');
      baseUrl.focus();
      return;
    }
    testButton.disabled = true;
    status.dataset.tone = 'pending';
    status.textContent = 'Calling the endpoint';
    try {
      const probe = await api.testProviderDraft({
        baseUrl: baseUrl.value.trim(),
        flavor: flavor.value as 'openai' | 'anthropic',
        apiKey: apiKey.value.trim() || undefined,
      });
      report(status, probe.ok, probe.ms, probe.status, probe.message);
    } catch (err) {
      status.dataset.tone = 'error';
      status.textContent = err instanceof Error ? err.message : 'The test could not run.';
    } finally {
      testButton.disabled = false;
    }
  });

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const name = label.value.trim();
    const url = baseUrl.value.trim();
    if (!name || !url) {
      toast('A label and a base URL are both required.', 'error');
      (name ? baseUrl : label).focus();
      return;
    }
    try {
      await api.createProvider({
        label: name,
        baseUrl: url,
        flavor: flavor.value as 'openai' | 'anthropic',
        apiKey: apiKey.value.trim() || undefined,
      });
      toast('Provider authorized.', 'ok');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the provider.', 'error');
    }
  };

  return el(
    'form',
    { class: 'team-provider-form', 'on:submit': (event: Event) => void submit(event) },
    micro('Authorize a provider'),
    el(
      'div',
      { class: 'team-form-row' },
      el('label', { class: 'field' }, el('span', { class: 'micro' }, 'Label'), label),
      el('label', { class: 'field team-field-wide' }, el('span', { class: 'micro' }, 'Base URL'), baseUrl),
    ),
    el(
      'div',
      { class: 'team-form-row' },
      el('label', { class: 'field team-field-wide' }, el('span', { class: 'micro' }, 'API key'), apiKey),
      el('label', { class: 'field' }, el('span', { class: 'micro' }, 'Shape'), flavor),
    ),
    el(
      'div',
      { class: 'team-form-foot' },
      el('div', { class: 'team-form-test' }, testButton, status),
      button('Save provider', () => undefined, { type: 'submit', variant: 'primary' }),
    ),
  );
}

function presetList(): HTMLElement {
  const note = el('p', { class: 'team-preset-note' }, 'Select a row to fill the form above.');

  const fill = (presetId: string): void => {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const form = document.querySelector<HTMLFormElement>('.team-provider-form');
    if (!form) return;
    const labelInput = form.querySelector<HTMLInputElement>('input[aria-label="Provider label"]');
    const urlInput = form.querySelector<HTMLInputElement>('input[aria-label="Base URL"]');
    const shape = form.querySelector<HTMLSelectElement>('select[aria-label="API shape"]');
    if (labelInput) labelInput.value = preset.label;
    if (urlInput) urlInput.value = preset.baseUrl;
    if (shape) shape.value = preset.flavor;
    note.textContent = `${preset.label} filled in. Add a key if the endpoint needs one, then save.`;
    labelInput?.focus();
    form.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return el(
    'details',
    { class: 'team-presets' },
    el('summary', { class: 'team-presets-summary' }, 'Start from a preset'),
    note,
    el(
      'ul',
      { class: 'team-preset-list' },
      ...PRESETS.map((preset) =>
        el(
          'li',
          null,
          el(
            'button',
            { type: 'button', class: 'team-preset-row', 'on:click': () => fill(preset.id) },
            el('span', { class: 'team-preset-label' }, preset.label),
            el('span', { class: 'team-preset-url' }, preset.baseUrl),
            el('span', { class: 'team-preset-where' }, preset.note),
          ),
        ),
      ),
    ),
  );
}

function separator(): HTMLElement {
  return el('span', { class: 'team-sep', 'aria-hidden': 'true' }, '/');
}

function report(target: HTMLElement, ok: boolean, ms: number, status: number, message: string): void {
  target.dataset.tone = ok ? 'ok' : 'error';
  target.textContent = ok
    ? `Reached in ${ms}ms (HTTP ${status})`
    : `Failed after ${ms}ms${status ? ` (HTTP ${status})` : ''}: ${message}`;
}
