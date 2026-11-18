import { ago, toast } from '../ui.js';
import { api } from '../api.js';
import type { Overview, RunRecord } from '../api.js';
import {
  button,
  el,
  excerpt,
  failure,
  iconButton,
  isLive,
  linkButton,
  micro,
  roleChip,
  runStatusCell,
  screen,
  sectionHead,
  type ScreenContext,
} from './shared.js';

const MAX_COMPOSER_HEIGHT = 260;

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
    const overview = await api.overview();
    if (isDisposed()) return;
    draw(ctx, overview);
  } catch (err) {
    if (isDisposed()) return;
    ctx.mount.replaceChildren(failure(err, () => void load(ctx, isDisposed)));
  }
}

function draw(ctx: ScreenContext, overview: Overview): void {
  let workspace = overview.settings.workspaceRoot || '';
  let sending = false;

  const workspaceValue = el('span', { class: 'today-workspace-value' }, workspace || 'No folder selected');
  const browser = workspaceBrowser(workspace, (picked) => {
    workspace = picked;
    workspaceValue.textContent = picked;
  });

  const composer = el(
    'section',
    { class: 'today-composer' },
    el('div', { class: 'today-composer-head' }, micro('New run'), el('span', { class: 'today-rule' })),
    ...composerBody({
      onWorkspace: () => browser.toggle(),
      getWorkspace: () => workspace,
      isSending: () => sending,
      setSending: (value) => {
        sending = value;
      },
      go: ctx.go,
    }),
    browser.element,
    el('div', { class: 'today-composer-foot' }, el('span', { class: 'today-workspace-label' }, 'Workspace'), workspaceValue),
  );

  ctx.mount.replaceChildren(
    screen(
      'today',
      masthead(overview),
      el(
        'div',
        { class: 'today-grid' },
        el('div', { class: 'today-main' }, composer, readinessStrip(ctx, overview)),
        el('aside', { class: 'today-aside' }, teamRoster(ctx, overview), runLedger(ctx, overview.recentRuns)),
      ),
    ),
  );
}

function masthead(overview: Overview): HTMLElement {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return el(
    'header',
    { class: 'today-masthead' },
    el(
      'div',
      { class: 'today-masthead-text' },
      micro(`Field manual / ${day}`),
      el('h1', { class: 'today-title' }, 'One prompt, a working team.'),
      el(
        'p',
        { class: 'today-lede' },
        'Write the work in plain language. The team turns it into a plan, splits it across the members you authorized, and leaves a record of every step.',
      ),
    ),
    el(
      'dl',
      { class: 'today-figures' },
      figure(String(overview.counts.assignments), 'members'),
      figure(String(overview.counts.providers), 'providers'),
      figure(String(overview.counts.runs), 'runs'),
    ),
  );
}

function figure(value: string, label: string): HTMLElement {
  return el('div', { class: 'today-figure' }, el('dt', { class: 'today-figure-value' }, value), el('dd', { class: 'today-figure-label' }, label));
}

interface ComposerHandlers {
  onWorkspace: () => void;
  getWorkspace: () => string;
  isSending: () => boolean;
  setSending: (value: boolean) => void;
  go: (route: string) => void;
}

function composerBody(handlers: ComposerHandlers): HTMLElement[] {
  const textarea = el('textarea', {
    class: 'today-textarea',
    rows: '4',
    placeholder: 'Describe the work. Name the files, the constraints, and what done looks like.',
    'aria-label': 'Run prompt',
    spellcheck: 'false',
  });

  const grow = (): void => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  };
  textarea.addEventListener('input', grow);

  const dispatch = button('Dispatch', () => void submit(), { variant: 'primary' });

  const submit = async (): Promise<void> => {
    const prompt = textarea.value.trim();
    if (!prompt) {
      toast('Write the work first.', 'info');
      textarea.focus();
      return;
    }
    if (handlers.isSending()) return;
    const workspace = handlers.getWorkspace();
    if (!workspace) {
      toast('Choose a workspace folder before dispatching.', 'error');
      return;
    }
    handlers.setSending(true);
    dispatch.disabled = true;
    dispatch.textContent = 'Dispatching';
    try {
      const run = await api.startRun({ prompt, workspace });
      handlers.go(`/runs/${run.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start the run.', 'error');
      handlers.setSending(false);
      dispatch.disabled = false;
      dispatch.textContent = 'Dispatch';
    }
  };

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  });

  return [
    textarea,
    el(
      'div',
      { class: 'today-composer-actions' },
      el('p', { class: 'today-composer-hint' }, 'Enter adds a line. Command and Enter dispatches. The team plans before it writes anything.'),
      dispatch,
    ),
    el('div', { class: 'today-composer-tools' }, linkButton('Choose folder', handlers.onWorkspace)),
  ];
}

function workspaceBrowser(initialPath: string, onPick: (path: string) => void) {
  const element = el('section', { class: 'today-browser', hidden: true, 'aria-label': 'Workspace folder' });
  const crumb = el('p', { class: 'today-browser-path' }, initialPath || 'Home');
  const list = el('div', { class: 'today-browser-list' });
  let current = initialPath;
  let parent = '';

  const open = async (path: string): Promise<void> => {
    list.replaceChildren(el('p', { class: 'today-browser-note' }, 'Reading folders'));
    try {
      const result = await api.fs(path);
      current = result.path;
      parent = result.parent;
      crumb.textContent = result.path;
      if (!result.dirs.length) {
        list.replaceChildren(el('p', { class: 'today-browser-note' }, 'No folders inside. You can still use this one.'));
        return;
      }
      list.replaceChildren(
        ...result.dirs.map((dir) =>
          el(
            'button',
            { type: 'button', class: 'today-browser-row', 'on:click': () => void open(dir.path) },
            el('span', { class: 'today-browser-row-name' }, dir.name),
            el('span', { class: 'today-browser-row-slash', 'aria-hidden': 'true' }, '/'),
          ),
        ),
      );
    } catch (err) {
      list.replaceChildren(failure(err, () => void open(path)));
    }
  };

  element.append(
    el(
      'div',
      { class: 'today-browser-head' },
      micro('Folders'),
      el(
        'div',
        { class: 'today-browser-controls' },
        iconButton('Parent folder', 'M8 13V3M4 7l4-4 4 4', () => void open(parent || current)),
        linkButton('Close', () => {
          element.hidden = true;
        }),
      ),
    ),
    crumb,
    list,
    el(
      'div',
      { class: 'today-browser-foot' },
      button(
        'Use this folder',
        () => {
          onPick(current);
          element.hidden = true;
        },
        { variant: 'primary' },
      ),
    ),
  );

  return {
    element,
    toggle(): void {
      element.hidden = !element.hidden;
      if (!element.hidden) void open(current);
    },
  };
}

interface ReadinessItem {
  ready: boolean;
  text: string;
  action?: { label: string; route: string };
}

function readinessStrip(ctx: ScreenContext, overview: Overview): HTMLElement {
  const items: ReadinessItem[] = [
    {
      ready: overview.readiness.hasTeam,
      text: overview.readiness.hasTeam
        ? `${overview.counts.assignments} members are authorized to work`
        : 'No team yet. Add a provider or a local harness, then give it a name and a role.',
      action: overview.readiness.hasTeam ? undefined : { label: 'Build the team', route: '/team' },
    },
    {
      ready: overview.readiness.hasPlanner,
      text: overview.readiness.hasPlanner
        ? 'A planner will shape the work before it runs'
        : 'No planner assigned. Runs fall back to a single builder with a simpler split.',
      action: overview.readiness.hasPlanner ? undefined : { label: 'Pick a planner', route: '/settings' },
    },
    {
      ready: overview.readiness.hasWorkspace,
      text: overview.readiness.hasWorkspace
        ? `Runs write inside ${overview.settings.workspaceRoot}`
        : 'No workspace root yet. Choose a folder so runs have somewhere to work.',
      action: overview.readiness.hasWorkspace ? undefined : { label: 'Set workspace', route: '/settings' },
    },
  ];
  const blocked = items.filter((item) => !item.ready).length;

  return el(
    'section',
    { class: 'today-readiness', 'aria-label': 'Run readiness' },
    micro(blocked ? `${blocked} things to settle before dispatch` : 'Ready to dispatch'),
    el(
      'ul',
      { class: 'today-readiness-list' },
      ...items.map((item) => {
        const action = item.action;
        return el(
          'li',
          { class: `today-readiness-item${item.ready ? ' today-readiness-item--ok' : ''}` },
          el('span', { class: 'today-readiness-mark', 'aria-hidden': 'true' }, item.ready ? '\u25aa' : '\u25ab'),
          el('span', { class: 'today-readiness-text' }, item.text),
          action
            ? linkButton(action.label, () => ctx.go(action.route))
            : el('span', { class: 'today-readiness-tag' }, 'Ready'),
        );
      }),
    ),
  );
}

function teamRoster(ctx: ScreenContext, overview: Overview): HTMLElement {
  const active = overview.team.filter((member) => member.enabled).length;
  const head = sectionHead('Team', `${active} of ${overview.team.length} active`, linkButton('Manage', () => ctx.go('/team')));

  if (!overview.team.length) {
    return el(
      'section',
      { class: 'today-roster' },
      head,
      emptyBlock(
        'The bench is empty',
        'Authorize a provider or a detected CLI, then give the member a name and a role. Two members is enough to start.',
        button('Authorize the first member', () => ctx.go('/team'), { variant: 'primary' }),
      ),
    );
  }

  return el(
    'section',
    { class: 'today-roster' },
    head,
    el(
      'ul',
      { class: 'today-roster-list' },
      ...overview.team.map((member) =>
        el(
          'li',
          { class: `today-roster-row${member.enabled ? '' : ' today-roster-row--off'}` },
          el('span', { class: 'today-roster-mark', 'aria-hidden': 'true' }, member.enabled ? '\u25aa' : '\u25ab'),
          el(
            'span',
            { class: 'today-roster-id' },
            el('span', { class: 'today-roster-alias' }, member.alias),
            el('span', { class: 'today-roster-model' }, `${member.providerLabel} / ${member.modelId}`),
          ),
          roleChip(member.role),
        ),
      ),
    ),
  );
}

function runLedger(ctx: ScreenContext, runs: RunRecord[]): HTMLElement {
  const head = sectionHead('Recent runs', undefined, linkButton('All runs', () => ctx.go('/runs')));

  if (!runs.length) {
    return el(
      'section',
      { class: 'today-ledger' },
      head,
      emptyBlock(
        'Nothing on the ledger',
        'The first dispatch takes a minute and leaves a full record here: plan, assignee, timing, output.',
        button('Back to the prompt', () => document.querySelector<HTMLTextAreaElement>('.today-textarea')?.focus()),
      ),
    );
  }

  return el(
    'section',
    { class: 'today-ledger' },
    head,
    el(
      'table',
      { class: 'today-ledger-table' },
      el(
        'thead',
        null,
        el('tr', null, el('th', { scope: 'col' }, 'Status'), el('th', { scope: 'col' }, 'Work'), el('th', { scope: 'col' }, 'Tasks')),
      ),
      el(
        'tbody',
        null,
        ...runs.slice(0, 6).map((run) => {
          const destination = `/runs/${run.id}`;
          const row = el(
            'tr',
            {
              class: `today-ledger-row${isLive(run.status) ? ' today-ledger-row--live' : ''}`,
              tabindex: '0',
              'on:click': () => ctx.go(destination),
              'on:keydown': (event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  ctx.go(destination);
                }
              },
            },
            el('td', null, runStatusCell(run.status)),
            el('td', { class: 'today-ledger-work' }, excerpt(run.prompt, 64)),
            el('td', { class: 'today-ledger-tasks' }, `${run.stats.done}/${run.stats.tasks}`),
          );
          row.title = ago(run.createdAt);
          return row;
        }),
      ),
    ),
  );
}

function emptyBlock(title: string, body: string, action: HTMLButtonElement): HTMLElement {
  return el(
    'div',
    { class: 'today-empty' },
    el('p', { class: 'today-empty-title' }, title),
    el('p', { class: 'today-empty-text' }, body),
    action,
  );
}
