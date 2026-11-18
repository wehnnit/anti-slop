import { toast } from '../ui.js';
import { api } from '../api.js';
import type { DetectionEntry, HarnessModel, HarnessRecord } from '../api.js';
import {
  button,
  el,
  iconButton,
  input,
  linkButton,
  micro,
  monoInput,
  sectionHead,
} from './shared.js';
import { addMemberButton, memberControls } from './team-member.js';
import type { TeamData } from './team-data.js';

export function localHarnesses(data: TeamData, refresh: () => void): HTMLElement {
  const detected = data.detection.filter(
    (entry) => entry.installed && !data.harnesses.some((harness) => harness.kind === entry.kind),
  );
  const blocks = data.harnesses.map((harness) =>
    harnessBlock(data, harness, data.harnessModels.filter((model) => model.harnessId === harness.id), refresh),
  );

  return el(
    'div',
    { class: 'team-half team-half--harness' },
    sectionHead('Local harnesses', 'CLIs on this machine. Nothing leaves the disk.'),
    data.harnesses.length
      ? el('div', { class: 'team-harnesses' }, ...blocks)
      : el(
          'p',
          { class: 'team-void' },
          detected.length
            ? 'A few CLIs were found on this machine. Authorize one to put it to work.'
            : 'No coding CLI found on PATH. Check that yours runs from a terminal first.',
        ),
    detected.length ? detectedList(detected, refresh) : null,
    customForm(refresh),
  );
}

function detectedList(detected: DetectionEntry[], refresh: () => void): HTMLElement {
  return el(
    'div',
    { class: 'team-detected' },
    micro('Found on this machine'),
    el(
      'ul',
      { class: 'team-detected-list' },
      ...detected.map((entry) =>
        el(
          'li',
          { class: 'team-detected-row' },
          el(
            'div',
            { class: 'team-detected-text' },
            el('span', { class: 'team-detected-label' }, entry.label),
            el('span', { class: 'team-detected-command' }, entry.version ? `${entry.command} \u00b7 ${entry.version}` : entry.command),
            entry.suggestedModels.length
              ? el('span', { class: 'team-detected-hints' }, entry.suggestedModels.join(', '))
              : null,
          ),
          button('Authorize', async () => {
            try {
              await api.createHarness({
                kind: entry.kind,
                label: entry.label,
                command: entry.command,
                version: entry.version,
              });
              toast(`${entry.label} authorized.`, 'ok');
              refresh();
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Could not authorize the harness.', 'error');
            }
          }),
        ),
      ),
    ),
  );
}

function harnessBlock(data: TeamData, harness: HarnessRecord, models: HarnessModel[], refresh: () => void): HTMLElement {
  const remove = async (): Promise<void> => {
    try {
      await api.deleteHarness(harness.id);
      toast('Harness removed.', 'ok');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove the harness.', 'error');
    }
  };

  return el(
    'article',
    { class: 'team-harness' },
    el(
      'header',
      { class: 'team-harness-head' },
      el(
        'div',
        { class: 'team-harness-id' },
        el('h3', { class: 'team-harness-label' }, harness.label),
        el('p', { class: 'team-harness-command' }, harness.version ? `${harness.command} \u00b7 ${harness.version}` : harness.command),
      ),
      el(
        'div',
        { class: 'team-harness-actions' },
        el('span', { class: 'team-kind' }, harness.kind),
        iconButton('Remove harness', 'M5 5l6 6M11 5l-6 6', () => void remove(), { variant: 'danger' }),
      ),
    ),
    models.length
      ? el('ul', { class: 'team-models' }, ...models.map((model) => modelRow(data, model, refresh)))
      : el('p', { class: 'team-void team-void--small' }, 'No model hints. The CLI uses its own default until you add one.'),
    modelForm(harness.id, refresh),
  );
}

function modelRow(data: TeamData, model: HarnessModel, refresh: () => void): HTMLElement {
  const assignment = data.assignments.find(
    (item) => item.source.kind === 'harness' && item.source.harnessModelId === model.id,
  );

  const toggle = async (): Promise<void> => {
    try {
      await api.updateHarnessModel(model.id, { enabled: !model.enabled });
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the model.', 'error');
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await api.deleteHarnessModel(model.id);
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
    ),
    assignment
      ? memberControls(assignment, refresh)
      : el(
          'div',
          { class: 'team-model-unassigned' },
          el('span', { class: 'team-model-note' }, 'Not on the team'),
          addMemberButton(data.assignments, model.label || model.modelId, { kind: 'harness', harnessModelId: model.id }, refresh),
        ),
    el(
      'div',
      { class: 'team-model-actions' },
      linkButton(model.enabled ? 'Disable' : 'Enable', () => void toggle()),
      iconButton('Remove model', 'M5 5l6 6M11 5l-6 6', () => void remove(), { variant: 'danger' }),
    ),
  );
}

function modelForm(harnessId: string, refresh: () => void): HTMLElement {
  const modelId = monoInput({ placeholder: 'model id for this CLI', 'aria-label': 'Harness model id' });

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const id = modelId.value.trim();
    if (!id) {
      toast('Type the model id this CLI should be called with.', 'error');
      modelId.focus();
      return;
    }
    try {
      await api.createHarnessModel({ harnessId, modelId: id, label: id });
      toast('Model hint added.', 'ok');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the model.', 'error');
    }
  };

  return el(
    'form',
    { class: 'team-model-form', 'on:submit': (event: Event) => void submit(event) },
    modelId,
    button('Add model', () => undefined, { type: 'submit' }),
  );
}

function customForm(refresh: () => void): HTMLElement {
  const label = input({ placeholder: 'Label', 'aria-label': 'Harness label' });
  const command = monoInput({ placeholder: 'command', 'aria-label': 'Harness command' });
  const args = monoInput({ placeholder: 'args template: {prompt} {model} {cwd}', 'aria-label': 'Arguments template' });

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const name = label.value.trim();
    const cmd = command.value.trim();
    if (!name || !cmd) {
      toast('A label and a command are both required.', 'error');
      return;
    }
    try {
      await api.createHarness({ kind: 'custom', label: name, command: cmd, argsTemplate: args.value.trim() || undefined });
      toast('Harness authorized.', 'ok');
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the harness.', 'error');
    }
  };

  return el(
    'details',
    { class: 'team-custom' },
    el('summary', { class: 'team-custom-summary' }, 'Add a CLI by hand'),
    el(
      'form',
      { class: 'team-custom-form', 'on:submit': (event: Event) => void submit(event) },
      el('label', { class: 'field' }, el('span', { class: 'micro' }, 'Label'), label),
      el('label', { class: 'field' }, el('span', { class: 'micro' }, 'Command'), command),
      el('label', { class: 'field team-field-wide' }, el('span', { class: 'micro' }, 'Arguments'), args),
      button('Authorize harness', () => undefined, { type: 'submit' }),
    ),
  );
}
