import { clock, confirmDialog, toast } from '../ui.js';
import { api } from '../api.js';
import type { RunEvent, RunRecord, TaskRecord } from '../api.js';
import {
  button,
  el,
  elapsed,
  excerpt,
  failure,
  isLive,
  isTerminal,
  micro,
  progressBar,
  runStatusCell,
  screen,
  sectionHead,
  type ScreenContext,
} from './shared.js';
import { metaItem, planPlaceholder, taskRow } from './run-plan.js';

const MAX_BUFFER = 120_000;

export function render(ctx: ScreenContext): () => void {
  const runId = ctx.param;
  if (!runId) {
    ctx.mount.replaceChildren(
      el(
        'div',
        { class: 'run-missing' },
        el('p', { class: 'run-missing-title' }, 'No run selected'),
        button('Open the ledger', () => ctx.go('/runs'), { variant: 'primary' }),
      ),
    );
    return () => undefined;
  }

  const view = new RunView(ctx, runId);
  void view.start();
  return () => view.dispose();
}

class RunView {
  private readonly ctx: ScreenContext;
  private readonly runId: string;
  private run: RunRecord | null = null;
  private tasks: TaskRecord[] = [];
  private selected: string | null = null;
  private readonly buffers = new Map<string, string>();
  private unsubscribe: (() => void) | null = null;
  private clockTimer: number | null = null;
  private frame: number | null = null;
  private disposed = false;

  private readonly title: HTMLElement;
  private readonly statusHost: HTMLElement;
  private readonly cancelHost: HTMLElement;
  private readonly metaHost: HTMLElement;
  private readonly progressHost: HTMLElement;
  private readonly planList: HTMLElement;
  private readonly streamTitle: HTMLElement;
  private readonly streamBody: HTMLElement;
  private readonly streamBox: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly summaryHost: HTMLElement;
  private readonly follow: HTMLInputElement;

  constructor(ctx: ScreenContext, runId: string) {
    this.ctx = ctx;
    this.runId = runId;
    this.title = el('h1', { class: 'run-title' }, 'Loading');
    this.statusHost = el('div', { class: 'run-status-host' });
    this.cancelHost = el('div', { class: 'run-cancel' });
    this.metaHost = el('dl', { class: 'run-meta' });
    this.progressHost = el('div', { class: 'run-progress' });
    this.planList = el('ol', { class: 'run-plan', 'aria-label': 'Plan' });
    this.streamTitle = el('h2', { class: 'run-stream-title' }, 'Output');
    this.streamBody = el('pre', { class: 'run-stream-body', tabindex: '0', 'aria-label': 'Task output' });
    this.caret = el('span', { class: 'run-caret', 'aria-hidden': 'true' });
    this.streamBox = el('div', { class: 'run-stream' }, this.streamBody, this.caret);
    this.summaryHost = el('div', { class: 'run-summary' });
    this.follow = el('input', { type: 'checkbox', class: 'run-follow-input', checked: true, 'aria-label': 'Follow new output' });
    this.streamBox.addEventListener('scroll', () => {
      if (!this.follow.checked) return;
      const nearBottom = this.streamBox.scrollTop + this.streamBox.clientHeight >= this.streamBox.scrollHeight - 24;
      if (!nearBottom) this.follow.checked = false;
    });
    this.paintShell();
  }

  async start(): Promise<void> {
    try {
      const detail = await api.run(this.runId);
      if (this.disposed) return;
      this.run = detail.run;
      this.tasks = detail.tasks;
      this.selected = this.pickInitialTask();
      this.paint();
      await this.backfill();
      if (this.disposed) return;
      if (!isTerminal(detail.run.status)) this.subscribe();
      this.startClock();
    } catch (err) {
      if (this.disposed) return;
      this.ctx.mount.replaceChildren(failure(err, () => void this.start()));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }

  private paintShell(): void {
    const root = screen(
      'run',
      el(
        'header',
        { class: 'run-head' },
        el(
          'button',
          { type: 'button', class: 'run-back', 'on:click': () => this.ctx.go('/runs') },
          el('span', { class: 'run-back-arrow', 'aria-hidden': 'true' }, '\u2190'),
          'All runs',
        ),
        el('div', { class: 'run-head-main' }, el('div', { class: 'run-head-title' }, micro(`Run ${this.runId.slice(0, 8)}`), this.title), this.statusHost, this.cancelHost),
        this.metaHost,
        this.progressHost,
      ),
      el(
        'div',
        { class: 'run-body' },
        el('section', { class: 'run-plan-pane' }, sectionHead('Plan', 'Select a task to follow its output.'), this.planList),
        el(
          'section',
          { class: 'run-stream-pane' },
          el(
            'header',
            { class: 'run-stream-head' },
            this.streamTitle,
            el('label', { class: 'run-follow' }, this.follow, el('span', null, 'Follow')),
          ),
          this.streamBox,
        ),
      ),
      this.summaryHost,
    );
    this.ctx.mount.replaceChildren(root);
  }

  private pickInitialTask(): string | null {
    const running = this.tasks.find((task) => task.status === 'running');
    if (running) return running.id;
    const assigned = this.tasks.find((task) => task.status === 'assigned');
    if (assigned) return assigned.id;
    return this.tasks[0]?.id ?? null;
  }

  private paint(): void {
    const run = this.run;
    if (!run) return;

    this.title.textContent = excerpt(run.prompt, 180);
    this.statusHost.replaceChildren(runStatusCell(run.status));
    this.cancelHost.replaceChildren(
      isLive(run.status)
        ? button('Cancel run', () => void this.cancel(), { variant: 'danger' })
        : button('Back to ledger', () => this.ctx.go('/runs')),
    );
    this.metaHost.replaceChildren(
      metaItem('Started', run.startedAt ? clock(run.startedAt) : 'not yet'),
      metaItem('Duration', run.startedAt ? elapsed(run.startedAt, run.finishedAt) : '--'),
      metaItem('Tasks', `${run.stats.done} of ${run.stats.tasks}`),
      metaItem('Tokens', String(run.stats.tokensIn + run.stats.tokensOut)),
      metaItem('Workspace', run.workspace || 'not set'),
    );
    this.progressHost.replaceChildren(progressBar(run.stats.done, run.stats.tasks));
    this.paintPlan();
    this.paintStream(true);
    this.paintSummary();
    this.paintClock();
  }

  private paintPlan(): void {
    if (!this.tasks.length) {
      this.planList.replaceChildren(planPlaceholder());
      return;
    }
    this.planList.replaceChildren(
      ...this.tasks.map((task, index) =>
        taskRow(task, index, task.id === this.selected, () => {
          this.selected = task.id;
          this.paintPlan();
          this.paintStream(true);
        }),
      ),
    );
  }

  private paintStream(scroll: boolean): void {
    const task = this.tasks.find((item) => item.id === this.selected);
    this.streamTitle.textContent = task ? task.title : 'Output';
    const text = task ? this.buffers.get(task.id) ?? task.output ?? '' : '';
    this.streamBody.textContent = text || (task ? 'Waiting for the first bytes.' : 'Select a task from the plan to read its output.');
    this.caret.hidden = !task || task.status !== 'running';
    if (scroll && this.follow.checked) this.streamBox.scrollTop = this.streamBox.scrollHeight;
  }

  private paintSummary(): void {
    const run = this.run;
    if (!run) return;

    if (run.status === 'done') {
      const body = run.summary?.trim();
      this.summaryHost.replaceChildren(
        el('h2', { class: 'run-summary-title' }, 'What came back'),
        body
          ? el('div', { class: 'run-summary-text' }, ...body.split(/\n{2,}/).map((para) => el('p', null, para)))
          : el('p', { class: 'run-summary-text' }, 'The run finished without a consolidated summary. Task output is above.'),
      );
      return;
    }
    if (run.status === 'failed') {
      this.summaryHost.replaceChildren(
        el('h2', { class: 'run-summary-title' }, 'Run failed'),
        el('p', { class: 'run-summary-text' }, run.error ?? 'The team did not return a summary.'),
      );
      return;
    }
    if (run.status === 'cancelled') {
      this.summaryHost.replaceChildren(
        el('h2', { class: 'run-summary-title' }, 'Cancelled'),
        el('p', { class: 'run-summary-text' }, 'The run stopped on request. Finished tasks keep their output; the rest never started.'),
      );
      return;
    }
    this.summaryHost.replaceChildren();
  }

  private paintClock(): void {
    const run = this.run;
    if (!run || !run.startedAt) return;
    const cells = this.metaHost.querySelectorAll('dd');
    if (cells[1]) cells[1].textContent = elapsed(run.startedAt, run.finishedAt);
  }

  private async backfill(): Promise<void> {
    try {
      const events = await api.events(this.runId, 0);
      if (this.disposed) return;
      for (const event of events) this.absorb(event);
      this.paintStatus();
      this.paintPlan();
      this.paintStream(true);
      this.paintSummary();
    } catch {
      return;
    }
  }

  private subscribe(): void {
    this.unsubscribe = api.subscribe((event) => {
      if (this.disposed || event.runId !== this.runId) return;
      this.absorb(event);
      this.schedulePaint();
    });
  }

  private absorb(event: RunEvent): void {
    if (event.type === 'task.delta' && event.taskId && typeof event.text === 'string') {
      this.append(event.taskId, event.text);
      return;
    }
    if (event.type === 'task.log' && event.taskId && typeof event.text === 'string') {
      this.append(event.taskId, `${event.text}\n`);
      return;
    }
    if (event.type === 'task.status' && event.status) {
      const task = event.taskId ? this.tasks.find((item) => item.id === event.taskId) : undefined;
      if (task) {
        task.status = event.status as TaskRecord['status'];
        if (task.status === 'running' && !task.startedAt) task.startedAt = event.at;
        if ((task.status === 'done' || task.status === 'failed' || task.status === 'skipped') && !task.finishedAt) {
          task.finishedAt = event.at;
        }
        if (!this.selected && task.status === 'running') this.selected = task.id;
      }
      return;
    }
    if (event.type === 'run.status' && event.status && this.run) {
      this.run.status = event.status as RunRecord['status'];
      return;
    }
    if (event.type === 'plan.ready' || event.type === 'run.done') {
      void this.reload();
    }
  }

  private append(taskId: string, text: string): void {
    const next = `${this.buffers.get(taskId) ?? ''}${text}`;
    this.buffers.set(taskId, next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next);
  }

  private schedulePaint(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.disposed) return;
      this.paintStatus();
      this.paintPlan();
      this.paintStream(false);
      if (this.run && isTerminal(this.run.status)) this.paintSummary();
    });
  }

  private paintStatus(): void {
    const run = this.run;
    if (!run) return;
    this.statusHost.replaceChildren(runStatusCell(run.status));
    run.stats.done = this.tasks.filter((task) => task.status === 'done').length;
    run.stats.failed = this.tasks.filter((task) => task.status === 'failed').length;
    if (this.tasks.length) run.stats.tasks = this.tasks.length;
    this.progressHost.replaceChildren(progressBar(run.stats.done, run.stats.tasks));
    this.paintClock();
  }

  private async reload(): Promise<void> {
    try {
      const detail = await api.run(this.runId);
      if (this.disposed) return;
      this.run = detail.run;
      this.tasks = detail.tasks;
      if (!this.selected || !this.tasks.some((task) => task.id === this.selected)) {
        this.selected = this.pickInitialTask();
      }
      const finished = isTerminal(this.run.status);
      this.paint();
      if (finished) {
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.clockTimer !== null) {
          window.clearInterval(this.clockTimer);
          this.clockTimer = null;
        }
      }
    } catch {
      return;
    }
  }

  private startClock(): void {
    this.clockTimer = window.setInterval(() => {
      if (this.disposed || !this.run) return;
      if (!isLive(this.run.status)) {
        if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
        this.clockTimer = null;
        return;
      }
      this.paintStatus();
      this.paintPlan();
    }, 1000);
  }

  private async cancel(): Promise<void> {
    const sure = await confirmDialog({
      title: 'Cancel this run?',
      body: 'Running tasks stop where they are. Finished work keeps its output.',
      confirmLabel: 'Cancel run',
      danger: true,
    });
    if (!sure) return;
    try {
      await api.cancelRun(this.runId);
      toast('Cancellation requested.', 'ok');
      await this.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not cancel the run.', 'error');
    }
  }
}
