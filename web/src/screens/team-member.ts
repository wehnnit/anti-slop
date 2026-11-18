import { toast } from '../ui.js';
import { api } from '../api.js';
import type { Assignment, TeamRole } from '../api.js';
import { el, iconButton, input, roleChip, select } from './shared.js';
import { suggestAlias } from './team-data.js';

const ROLES: TeamRole[] = ['planner', 'builder', 'reviewer', 'any'];

export function memberControls(assignment: Assignment, onChange: () => void): HTMLElement {
  const alias = input({
    class: 'input team-alias-input',
    value: assignment.alias,
    maxlength: '32',
    'aria-label': `Alias for ${assignment.alias}`,
  });

  const commitAlias = async (): Promise<void> => {
    const next = alias.value.trim();
    if (!next || next === assignment.alias) {
      alias.value = assignment.alias;
      return;
    }
    try {
      await api.updateAssignment(assignment.id, { alias: next });
      onChange();
    } catch (err) {
      alias.value = assignment.alias;
      toast(err instanceof Error ? err.message : 'Could not rename the member.', 'error');
    }
  };
  alias.addEventListener('blur', () => void commitAlias());
  alias.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      alias.blur();
    }
  });

  const role = select(
    ROLES.map((value) => ({ value, label: value })),
    { value: assignment.role, 'aria-label': `Role for ${assignment.alias}`, class: 'input select team-role-select' },
  );
  role.addEventListener('change', async () => {
    const next = role.value as TeamRole;
    try {
      await api.updateAssignment(assignment.id, { role: next });
      onChange();
    } catch (err) {
      role.value = assignment.role;
      toast(err instanceof Error ? err.message : 'Could not change the role.', 'error');
    }
  });

  const enabled = el('input', {
    type: 'checkbox',
    class: 'team-switch-input',
    checked: assignment.enabled,
    'aria-label': `Enable ${assignment.alias}`,
  });
  enabled.addEventListener('change', async () => {
    try {
      await api.updateAssignment(assignment.id, { enabled: enabled.checked });
      onChange();
    } catch (err) {
      enabled.checked = assignment.enabled;
      toast(err instanceof Error ? err.message : 'Could not update the member.', 'error');
    }
  });

  const remove = async (): Promise<void> => {
    try {
      await api.deleteAssignment(assignment.id);
      toast('Member withdrawn.', 'ok');
      onChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove the member.', 'error');
    }
  };

  return el(
    'div',
    { class: 'team-member' },
    el('span', { class: 'team-member-state', 'aria-hidden': 'true' }, assignment.enabled ? '\u25aa' : '\u25ab'),
    alias,
    role,
    el(
      'label',
      { class: 'team-switch' },
      enabled,
      el('span', { class: 'team-switch-track', 'aria-hidden': 'true' }),
      el('span', { class: 'team-switch-text' }, assignment.enabled ? 'On' : 'Off'),
    ),
    iconButton('Withdraw member', 'M5 5l6 6M11 5l-6 6', () => void remove(), { variant: 'danger' }),
  );
}

export function addMemberButton(
  existing: Assignment[],
  prefix: string,
  source: Assignment['source'],
  onAdded: () => void,
): HTMLElement {
  return el(
    'button',
    {
      type: 'button',
      class: 'team-add-member',
      'on:click': async () => {
        try {
          await api.createAssignment({ alias: suggestAlias(prefix, existing), role: 'any', source });
          toast('Added to the team.', 'ok');
          onAdded();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Could not add the member.', 'error');
        }
      },
    },
    'Add to team',
  );
}

export function roleLegend(): HTMLElement {
  return el(
    'dl',
    { class: 'team-legend' },
    el('div', null, el('dt', null, roleChip('planner')), el('dd', null, 'shapes the plan')),
    el('div', null, el('dt', null, roleChip('builder')), el('dd', null, 'does the work')),
    el('div', null, el('dt', null, roleChip('reviewer')), el('dd', null, 'reconciles output')),
    el('div', null, el('dt', null, roleChip('any')), el('dd', null, 'takes whatever comes')),
  );
}
