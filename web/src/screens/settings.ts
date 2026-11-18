import { ago, copyText, toast } from '../ui.js';
import { api } from '../api.js';
import type { Assignment, Overview, ProjectRecord, Settings } from '../api.js';
import { folderPicker } from './folder-picker.js';
import {
  button,
  callout,
  el,
  failure,
  input,
  linkButton,
  micro,
  screen,
  sectionHead,
  select,
  type ScreenContext,
} from './shared.js';

interface Loaded {
  settings: Settings;
  overview: Overview;
  assignments: Assignment[];
}

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
    const [settings, overview, assignments] = await Promise.all([api.settings(), api.overview(), api.assignments()]);
    if (isDisposed()) return;
    draw(ctx, { settings, overview, assignments });
  } catch (err) {
    if (isDisposed()) return;
    ctx.mount.replaceChildren(failure(err, () => void load(ctx, isDisposed)));
  }
}

function draw(ctx: ScreenContext, loaded: Loaded): void {
  const save = async (patch: Partial<Settings>, message: string): Promise<void> => {
    try {
      const next = await api.saveSettings(patch);
      loaded.settings = next;
      toast(message, 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the setting.', 'error');
    }
  };

  ctx.mount.replaceChildren(
    screen(
      'settings',
      el(
        'header',
        { class: 'settings-masthead' },
        micro('Settings'),
        el('h1', { class: 'settings-title' }, 'How the harness behaves.'),
        el(
          'p',
          { class: 'settings-lede' },
          'One file on this machine holds all of it. Nothing syncs, nothing phones home, and you can read every value below.',
        ),
      ),
      el(
        'div',
        { class: 'settings-columns' },
        el(
          'div',
          { class: 'settings-main' },
          workSection(loaded, save),
          planningSection(loaded, save),
          projectsSection(loaded, ctx),
          dangerSection(loaded),
        ),
        el('aside', { class: 'settings-side' }, aboutSection(loaded)),
      ),
    ),
  );
}

function workSection(loaded: Loaded, save: (patch: Partial<Settings>, message: string) => Promise<void>): HTMLElement {
  const root = input({
    class: 'input settings-input-mono',
    value: loaded.settings.workspaceRoot,
    placeholder: '~/Projects',
    'aria-label': 'Workspace root',
  });
  const hint = el('p', { class: 'settings-hint' }, 'Runs write inside this folder. The support folder stays separate.');

  const commitRoot = async (): Promise<void> => {
    const next = root.value.trim();
    if (next === loaded.settings.workspaceRoot) return;
    await save({ workspaceRoot: next }, 'Workspace root saved.');
    hint.textContent = next ? `Runs will write inside ${next}.` : 'No workspace root. Choose a folder before dispatching.';
  };
  root.addEventListener('blur', () => void commitRoot());
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      root.blur();
    }
  });

  const concurrency = el('input', {
    type: 'number',
    min: '1',
    max: '8',
    step: '1',
    class: 'input settings-input-number',
    value: String(loaded.settings.concurrency),
    'aria-label': 'Concurrent tasks',
  });
  concurrency.addEventListener('change', () => {
    const next = Math.max(1, Math.min(8, Number(concurrency.value) || 1));
    concurrency.value = String(next);
    void save({ concurrency: next }, 'Concurrency saved.');
  });

  const review = el('input', {
    type: 'checkbox',
    class: 'settings-switch-input',
    checked: loaded.settings.autoReview,
    'aria-label': 'Reconcile every run',
  });
  review.addEventListener('change', () => {
    void save({ autoReview: review.checked }, review.checked ? 'Review pass enabled.' : 'Review pass disabled.');
  });

  return el(
    'section',
    { class: 'settings-block' },
    sectionHead('Work', 'Where runs write, and how much runs at once.'),
    el(
      'div',
      { class: 'settings-field' },
      el('label', { class: 'field' }, el('span', { class: 'micro' }, 'Workspace root'), root),
      hint,
    ),
    el(
      'div',
      { class: 'settings-row' },
      el(
        'div',
        { class: 'settings-field settings-field--half' },
        el('label', { class: 'field' }, el('span', { class: 'micro' }, 'Concurrent tasks'), concurrency),
        el('p', { class: 'settings-hint' }, 'Between 1 and 8. Higher finishes sooner but spends more at once.'),
      ),
      el(
        'div',
        { class: 'settings-field settings-field--half' },
        el(
          'label',
          { class: 'settings-switch' },
          review,
          el('span', { class: 'settings-switch-track', 'aria-hidden': 'true' }),
          el('span', null, 'Reconcile each run'),
        ),
        el('p', { class: 'settings-hint' }, 'A reviewer reads the finished tasks and writes one summary.'),
      ),
    ),
  );
}

function projectsSection(loaded: Loaded, ctx: ScreenContext): HTMLElement {
  const projects: ProjectRecord[] = loaded.overview.projects.slice();
  const list = el('div', { class: 'settings-projects' });

  const picker = folderPicker({
    current: loaded.overview.projects.find((item) => item.id === loaded.settings.activeProjectId)?.path,
    existing: projects,
    onChoose: (path, project) => {
      if (project) void api.saveSettings({ workspaceRoot: project.path, activeProjectId: project.id });
      else void api.saveSettings({ workspaceRoot: path });
      toast('Working folder saved.', 'ok');
      ctx.refresh();
    },
    onProjectsChanged: () => ctx.refresh(),
  });

  const renderRows = (): void => {
    list.replaceChildren();
    if (!projects.length) {
      list.append(
        el('p', { class: 'settings-hint' },
          'No project folders yet. Connect any folder on this Mac and the team will work inside it.'),
      );
      return;
    }
    for (const project of projects) {
      const active = loaded.settings.activeProjectId === project.id || loaded.settings.workspaceRoot === project.path;
      list.append(
        el(
          'div',
          { class: 'settings-project' + (active ? ' settings-project--active' : '') },
          el(
            'div',
            { class: 'settings-project-text' },
            el('span', { class: 'settings-project-name' }, project.label),
            el('span', { class: 'settings-project-path' }, project.path),
          ),
          active ? el('span', { class: 'settings-project-tag' }, 'in use') : null,
          el(
            'div',
            { class: 'settings-project-actions' },
            active ? null : button('Use', () => { void use(project); }),
            button('Forget', () => { void forget(project); }, { variant: 'ghost' }),
          ),
        ),
      );
    }
  };

  const use = async (project: ProjectRecord): Promise<void> => {
    try {
      await api.saveSettings({ workspaceRoot: project.path, activeProjectId: project.id });
      toast('Switched to ' + project.label + '.', 'ok');
      ctx.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not switch project.', 'error');
    }
  };

  const forget = async (project: ProjectRecord): Promise<void> => {
    try {
      await api.deleteProject(project.id);
      toast('Removed ' + project.label + ' from the list. The folder itself is untouched.', 'ok');
      ctx.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove that project.', 'error');
    }
  };

  renderRows();

  return el(
    'section',
    { class: 'settings-block' },
    sectionHead('Projects', 'Folders on this Mac that the team may work in.', linkButton('Connect a folder', () => picker.toggle())),
    list,
    picker.element,
  );
}
function planningSection(loaded: Loaded, save: (patch: Partial<Settings>, message: string) => Promise<void>): HTMLElement {
  const candidates = loaded.assignments.filter((item) => item.enabled);
  const options = [
    { value: '', label: 'First enabled member' },
    ...candidates.map((item) => ({
      value: item.id,
      label: item.alias + ' / ' + item.role,
    })),
  ];

  const picker = select(options, {
    value: loaded.settings.plannerAssignmentId ?? '',
    'aria-label': 'Planner assignment',
  });
  picker.addEventListener('change', () => {
    const value = picker.value;
    void save({ plannerAssignmentId: value || undefined }, value ? 'Planner saved.' : 'Planner cleared.');
  });

  const current = loaded.settings.plannerAssignmentId
    ? loaded.assignments.find((item) => item.id === loaded.settings.plannerAssignmentId)
    : undefined;

  return el(
    'section',
    { class: 'settings-block' },
    sectionHead('Planning', 'Who turns a prompt into a plan.'),
    el(
      'div',
      { class: 'settings-field' },
      el('label', { class: 'field' }, el('span', { class: 'micro' }, 'Planner'), picker),
      el(
        'p',
        { class: 'settings-hint' },
        current
          ? `${current.alias} plans every run. If it is disabled, the engine picks the first enabled member.`
          : 'With no planner named, the first enabled member plans the work.',
      ),
    ),
    candidates.length
      ? null
      : callout(
          'warn',
          'No members on duty',
          'Planning needs at least one enabled member. Add one on the team screen.',
          linkButton('Open the team', () => undefined),
        ),
  );
}

function dangerSection(loaded: Loaded): HTMLElement {
  const exportLine = el('code', { class: 'settings-path' }, `${loaded.overview.root}/data`);
  const supportLine = el('code', { class: 'settings-path' }, loaded.overview.root);

  const reveal = (): void => {
    void copyText(loaded.overview.root);
  };

  return el(
    'section',
    { class: 'settings-block settings-block--danger' },
    sectionHead('Handling', 'Export, and the one destructive fact.'),
    el(
      'div',
      { class: 'settings-fact' },
      el('p', { class: 'settings-fact-label' }, 'Data folder'),
      exportLine,
      el('p', { class: 'settings-hint' }, 'Providers, models, members, runs, and keys live here as plain JSON. Copy the folder to back it up.'),
    ),
    el(
      'div',
      { class: 'settings-fact' },
      el('p', { class: 'settings-fact-label' }, 'Uninstalling'),
      supportLine,
      el(
        'p',
        { class: 'settings-hint' },
        'Deleting this folder removes everything: the team, the keys, and every run record. The binary holds nothing after the folder is gone.',
      ),
      el('div', { class: 'settings-fact-actions' }, button('Copy support folder path', reveal)),
    ),
  );
}

function aboutSection(loaded: Loaded): HTMLElement {
  return el(
    'section',
    { class: 'settings-about' },
    el('h2', { class: 'settings-about-title' }, 'Anti-Slop'),
    el(
      'dl',
      { class: 'settings-about-list' },
      row('Version', loaded.overview.version),
      row('Support folder', loaded.overview.root),
      row('Settings saved', ago(loaded.settings.updatedAt)),
      row('Runs on record', String(loaded.overview.counts.runs)),
    ),
    el(
      'p',
      { class: 'settings-about-note' },
      'A local command-line harness and this dashboard. No account, no telemetry, no hosted state.',
    ),
  );
}

function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'settings-about-row' }, el('dt', null, label), el('dd', null, value));
}
