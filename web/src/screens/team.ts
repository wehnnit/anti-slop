import { el, failure, micro, roleChip, screen, sectionHead, type ScreenContext } from './shared.js';
import { loadTeamData, sourceLabel, type TeamData } from './team-data.js';
import { directApis } from './team-providers.js';
import { localHarnesses } from './team-harnesses.js';
import { memberControls, roleLegend } from './team-member.js';

export function render(ctx: ScreenContext): () => void {
  let disposed = false;
  ctx.mount.replaceChildren(el('div', { class: 'fm-loading', 'aria-busy': 'true' }));
  void load(ctx, () => disposed);
  return () => {
    disposed = true;
  };
}

async function load(ctx: ScreenContext, isDisposed: () => boolean): Promise<void> {
  try {
    const data = await loadTeamData();
    if (isDisposed()) return;
    draw(ctx, data, isDisposed);
  } catch (err) {
    if (isDisposed()) return;
    ctx.mount.replaceChildren(failure(err, () => void load(ctx, isDisposed)));
  }
}

function draw(ctx: ScreenContext, data: TeamData, isDisposed: () => boolean): void {
  const refresh = (): void => void load(ctx, isDisposed);
  const active = data.assignments.filter((item) => item.enabled).length;

  ctx.mount.replaceChildren(
    screen(
      'team',
      el(
        'header',
        { class: 'team-masthead' },
        el(
          'div',
          { class: 'team-masthead-text' },
          micro('Authorization surface'),
          el('h1', { class: 'team-title' }, 'Who is allowed to work.'),
          el(
            'p',
            { class: 'team-lede' },
            'Every endpoint and every CLI this harness may call appears here. Nothing runs without a member row, a role, and the switch left on.',
          ),
          roleLegend(),
        ),
        el(
          'dl',
          { class: 'team-figures' },
          figure(String(data.providers.length), 'providers'),
          figure(String(data.harnesses.length), 'harnesses'),
          figure(`${active}/${data.assignments.length}`, 'on duty'),
        ),
      ),
      el('div', { class: 'team-columns' }, directApis(data, refresh), localHarnesses(data, refresh)),
      roster(data, refresh),
    ),
  );
}

function figure(value: string, label: string): HTMLElement {
  return el(
    'div',
    { class: 'team-figure' },
    el('dt', { class: 'team-figure-value' }, value),
    el('dd', { class: 'team-figure-label' }, label),
  );
}

function roster(data: TeamData, refresh: () => void): HTMLElement {
  return el(
    'section',
    { class: 'team-roster' },
    sectionHead('Roster', 'Names, roles, and switches. Only enabled members get scheduled.'),
    data.assignments.length
      ? el(
          'ul',
          { class: 'team-roster-list' },
          ...data.assignments.map((assignment) =>
            el(
              'li',
              { class: `team-roster-row${assignment.enabled ? '' : ' team-roster-row--off'}` },
              el(
                'div',
                { class: 'team-roster-source' },
                el('span', { class: 'team-roster-alias' }, assignment.alias),
                el('span', { class: 'team-roster-origin' }, sourceLabel(data, assignment)),
                roleChip(assignment.role),
              ),
              memberControls(assignment, refresh),
            ),
          ),
        )
      : el(
          'p',
          { class: 'team-void' },
          'No members yet. Add a model from either column above. Two members is enough to start.',
        ),
    el(
      'p',
      { class: 'team-roster-note' },
      'Withdrawing a member keeps the provider and the CLI in place. It only removes the authorization.',
    ),
  );
}
