import { ago } from '../ui.js';
import { api } from '../api.js';
import type { RunRecord } from '../api.js';
import {
  button,
  compactNumber,
  el,
  elapsed,
  excerpt,
  failure,
  isLive,
  micro,
  runStatusCell,
  screen,
  select,
  type ScreenContext,
} from './shared.js';

type Filter = 'all' | 'active' | 'done' | 'closed';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All runs' },
  { value: 'active', label: 'In flight' },
  { value: 'done', label: 'Completed' },
  { value: 'closed', label: 'Failed or cancelled' },
];

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
    const runs = await api.runs(200);
    if (isDisposed()) return;
    draw(ctx, runs);
  } catch (err) {
    if (isDisposed()) return;
    ctx.mount.replaceChildren(failure(err, () => void load(ctx, isDisposed)));
  }
}

function draw(ctx: ScreenContext, runs: RunRecord[]): void {
  let filter: Filter = 'all';
  let query = '';

  const countLine = el('p', { class: 'runs-count' });
  const list = el('div', { class: 'runs-list' });

  const matches = (run: RunRecord): boolean => {
    if (filter === 'active' && !isLive(run.status)) return false;
    if (filter === 'done' && run.status !== 'done') return false;
    if (filter === 'closed' && run.status !== 'failed' && run.status !== 'cancelled') return false;
    if (query && !run.prompt.toLowerCase().includes(query)) return false;
    return true;
  };

  const paint = (): void => {
    const visible = runs.filter(matches);
    countLine.textContent =
      visible.length === runs.length
        ? `${runs.length} ${runs.length === 1 ? 'run' : 'runs'} on record`
        : `${visible.length} of ${runs.length} runs`;
    if (!runs.length) {
      list.replaceChildren(emptyLedger(ctx));
      return;
    }
    list.replaceChildren(visible.length ? ledger(ctx, visible) : noMatches());
  };

  const statusSelect = select(FILTERS, { 'aria-label': 'Filter runs by status', value: filter });
  statusSelect.addEventListener('change', () => {
    filter = statusSelect.value as Filter;
    paint();
  });

  const search = el('input', {
    type: 'search',
    class: 'input runs-search',
    placeholder: 'Search prompts',
    'aria-label': 'Search prompts',
    'on:input': (event: Event) => {
      query = (event.target as HTMLInputElement).value.trim().toLowerCase();
      paint();
    },
  });

  paint();

  ctx.mount.replaceChildren(
    screen(
      'runs',
      el(
        'header',
        { class: 'runs-masthead' },
        el(
          'div',
          { class: 'runs-masthead-text' },
          micro('Ledger'),
          el('h1', { class: 'runs-title' }, 'Every run, kept.'),
          el(
            'p',
            { class: 'runs-lede' },
            'A run is the record of one dispatch: its plan, who did what, how long it took, and what came back.',
          ),
        ),
        button('New run', () => ctx.go('/'), { variant: 'primary' }),
      ),
      el('div', { class: 'runs-toolbar' }, el('div', { class: 'runs-filters' }, statusSelect, search), countLine),
      list,
    ),
  );
}

function noMatches(): HTMLElement {
  return el(
    'div',
    { class: 'runs-none' },
    el('p', { class: 'runs-none-title' }, 'Nothing matches this filter'),
    el('p', { class: 'runs-none-text' }, 'Clear the search or choose another status.'),
  );
}

function emptyLedger(ctx: ScreenContext): HTMLElement {
  return el(
    'div',
    { class: 'runs-empty' },
    el('p', { class: 'runs-empty-title' }, 'The ledger is blank'),
    el(
      'p',
      { class: 'runs-empty-text' },
      'Nothing has run from this workspace yet. The first dispatch writes a plan, the assignments, and the full transcript here.',
    ),
    button('Write the first prompt', () => ctx.go('/'), { variant: 'primary' }),
  );
}

function ledger(ctx: ScreenContext, runs: RunRecord[]): HTMLElement {
  return el(
    'table',
    { class: 'runs-table' },
    el(
      'thead',
      null,
      el(
        'tr',
        null,
        el('th', { scope: 'col', class: 'runs-col-status' }, 'Status'),
        el('th', { scope: 'col' }, 'Work'),
        el('th', { scope: 'col', class: 'runs-col-num' }, 'Tasks'),
        el('th', { scope: 'col', class: 'runs-col-num' }, 'Tokens'),
        el('th', { scope: 'col', class: 'runs-col-num' }, 'Duration'),
        el('th', { scope: 'col', class: 'runs-col-when' }, 'Started'),
      ),
    ),
    el('tbody', null, ...runs.map((run) => ledgerRow(ctx, run))),
  );
}

function ledgerRow(ctx: ScreenContext, run: RunRecord): HTMLElement {
  const destination = `/runs/${run.id}`;
  return el(
    'tr',
    {
      class: `runs-row${isLive(run.status) ? ' runs-row--live' : ''}`,
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
    el(
      'td',
      { class: 'runs-work' },
      el('p', { class: 'runs-prompt' }, excerpt(run.prompt, 220)),
      el('p', { class: 'runs-workspace' }, run.workspace),
    ),
    el('td', { class: 'runs-col-num' }, `${run.stats.done}/${run.stats.tasks}`),
    el('td', { class: 'runs-col-num runs-mono' }, compactNumber(run.stats.tokensIn + run.stats.tokensOut)),
    el('td', { class: 'runs-col-num runs-mono' }, runDuration(run)),
    el('td', { class: 'runs-col-when' }, ago(run.createdAt)),
  );
}

function runDuration(run: RunRecord): string {
  if (run.startedAt) return elapsed(run.startedAt, run.finishedAt);
  if (run.status === 'queued') return 'queued';
  return elapsed(run.createdAt, run.finishedAt);
}
