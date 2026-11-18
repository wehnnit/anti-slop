import { mkdirSync } from 'node:fs';
import { publish } from '../server/bus.js';
import {
  appendEvent,
  getSettings,
  listRuns,
  newId,
  nowIso,
  readTasks,
  resolveWorkspace,
  writeRun,
  writeTasks,
} from '../store/index.js';
import type { CompletionRequest, RunEvent, RunRecord, RunStatus, TaskRecord } from '../types.js';
import { runHarness } from '../harnesses/run.js';
import { complete } from '../providers/index.js';
import { fallbackPlan, makePlan, type PlanResult } from './planner.js';
import { nextBatch } from './scheduler.js';
import { activeMembers, choosePlanner, pickAssignee, resolveMembers, type Member } from './team.js';

export { listTeam } from './team.js';

interface ActiveRun {
  run: RunRecord;
  controller: AbortController;
  seq: number;
  tasks: TaskRecord[];
}

const active = new Map<string, ActiveRun>();

const TASK_SYSTEM = [
  'You are one worker on a small local coding team.',
  'You receive one task and the workspace path. Do the task and report what you changed.',
  'Be concrete: name the files you touched and the behaviour that changed.',
  'Do not narrate your process. Do not ask questions. If you cannot finish, say exactly what blocked you.',
].join(' ');

function emit(state: ActiveRun, event: Omit<RunEvent, 'seq' | 'at' | 'runId'>): void {
  state.seq += 1;
  const ev: RunEvent = { seq: state.seq, at: nowIso(), runId: state.run.id, ...event };
  appendEvent(ev);
  publish(ev);
}

function persist(state: ActiveRun): void {
  const end = state.run.finishedAt ? Date.parse(state.run.finishedAt) : Date.now();
  const start = state.run.startedAt ? Date.parse(state.run.startedAt) : end;
  const stats = {
    tasks: state.tasks.length,
    done: state.tasks.filter((t) => t.status === 'done').length,
    failed: state.tasks.filter((t) => t.status === 'failed').length,
    tokensIn: state.run.stats.tokensIn,
    tokensOut: state.run.stats.tokensOut,
    ms: Math.max(0, end - start),
  };
  state.run = { ...state.run, stats };
  writeRun(state.run);
  writeTasks(state.run.id, state.tasks);
}

function setStatus(state: ActiveRun, status: RunStatus): void {
  state.run = { ...state.run, status };
  persist(state);
  emit(state, { type: 'run.status', status });
}

function buildTaskPrompt(run: RunRecord, task: TaskRecord): string {
  const acceptance = task.acceptance.length > 0 ? task.acceptance.map((item) => `- ${item}`).join('\n') : '- The task is complete and reported plainly.';
  return [
    `Workspace: ${run.workspace}`,
    `Task: ${task.title}`,
    '',
    task.brief,
    '',
    'Done when:',
    acceptance,
  ].join('\n');
}

async function executeTask(state: ActiveRun, task: TaskRecord, member: Member): Promise<void> {
  const prompt = buildTaskPrompt(state.run, task);
  let text = '';
  let tokensIn = 0;
  let tokensOut = 0;
  let lastPublish = 0;

  const pushDelta = (chunk: string, force = false): void => {
    text += chunk;
    const now = Date.now();
    if (!force && now - lastPublish < 120) return;
    lastPublish = now;
    const index = state.tasks.findIndex((t) => t.id === task.id);
    if (index !== -1) state.tasks[index] = { ...state.tasks[index]!, output: text };
    emit(state, { type: 'task.delta', taskId: task.id, text: chunk });
  };

  try {
    if (member.kind === 'api') {
      const request: CompletionRequest = {
        baseUrl: member.provider.baseUrl,
        apiKey: member.apiKey,
        headers: member.provider.headers,
        model: member.model.modelId,
        system: TASK_SYSTEM,
        prompt,
        maxTokens: 4000,
        signal: state.controller.signal,
      };
      for await (const chunk of complete(request, member.provider.flavor)) {
        if (chunk.type === 'text') pushDelta(chunk.text);
        else {
          tokensIn += chunk.usage.tokensIn ?? 0;
          tokensOut += chunk.usage.tokensOut ?? 0;
        }
      }
    } else {
      const result = await runHarness(member.harness, {
        prompt: `${TASK_SYSTEM}\n\n${prompt}`,
        model: member.model.modelId,
        cwd: state.run.workspace,
        signal: state.controller.signal,
        onChunk: pushDelta,
      });
      if (!text.trim() && result.text.trim()) text = result.text;
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `The command exited with ${result.exitCode}.`);
    }

    state.run = {
      ...state.run,
      stats: {
        ...state.run.stats,
        tokensIn: state.run.stats.tokensIn + tokensIn,
        tokensOut: state.run.stats.tokensOut + tokensOut,
      },
    };

    const index = state.tasks.findIndex((t) => t.id === task.id);
    if (index === -1) return;
    const finished: TaskRecord = {
      ...state.tasks[index]!,
      status: 'done',
      output: text.trim() || 'Finished with no output.',
      finishedAt: nowIso(),
    };
    state.tasks[index] = finished;
    persist(state);
    emit(state, { type: 'task.status', taskId: task.id, status: 'done' });
  } catch (err) {
    const aborted = state.controller.signal.aborted;
    const index = state.tasks.findIndex((t) => t.id === task.id);
    if (index === -1) return;
    const failed: TaskRecord = {
      ...state.tasks[index]!,
      status: aborted ? 'skipped' : 'failed',
      error: aborted ? 'Cancelled.' : err instanceof Error ? err.message : String(err),
      output: text.trim() || undefined,
      finishedAt: nowIso(),
    };
    state.tasks[index] = failed;
    persist(state);
    emit(state, { type: 'task.status', taskId: task.id, status: failed.status });
  }
}

async function reviewRun(state: ActiveRun, reviewer: Member): Promise<void> {
  setStatus(state, 'reviewing');
  const finished = state.tasks.filter((task) => task.status === 'done');
  if (finished.length === 0) return;

  const digest = finished
    .map((task) => `# ${task.title}\n${(task.output ?? '').slice(0, 1200)}`)
    .join('\n\n');

  const prompt = [
    `Brief: ${state.run.prompt}`,
    '',
    'Each worker reported the following.',
    '',
    digest,
    '',
    'Write one short summary of what the team delivered. Name the files that changed and anything that still needs a person. No preamble.',
  ].join('\n');

  let summary = '';
  try {
    if (reviewer.kind === 'api') {
      const request: CompletionRequest = {
        baseUrl: reviewer.provider.baseUrl,
        apiKey: reviewer.apiKey,
        headers: reviewer.provider.headers,
        model: reviewer.model.modelId,
        system: TASK_SYSTEM,
        prompt,
        maxTokens: 800,
        signal: state.controller.signal,
      };
      for await (const chunk of complete(request, reviewer.provider.flavor)) {
        if (chunk.type === 'text') summary += chunk.text;
      }
    } else {
      const result = await runHarness(reviewer.harness, {
        prompt: `${TASK_SYSTEM}\n\n${prompt}`,
        model: reviewer.model.modelId,
        cwd: state.run.workspace,
        signal: state.controller.signal,
      });
      summary = result.text;
    }
  } catch (err) {
    emit(state, { type: 'run.log', text: `Review skipped: ${err instanceof Error ? err.message : String(err)}` });
  }

  if (summary.trim()) {
    state.run = { ...state.run, summary: summary.trim() };
    persist(state);
  }
}

async function drive(state: ActiveRun): Promise<void> {
  const settings = getSettings();
  const members = resolveMembers();
  const concurrency = Math.max(1, Math.min(8, settings.concurrency));
  const running = new Set<string>();
  const load = new Map<string, number>();
  const started = new Set<string>();

  state.run = { ...state.run, startedAt: state.run.startedAt ?? nowIso() };
  setStatus(state, 'running');
  emit(state, { type: 'plan.ready', payload: state.tasks.map((task) => ({
    key: task.key,
    title: task.title,
    brief: task.brief,
    acceptance: task.acceptance,
    role: task.role,
    dependsOn: task.dependsOn,
  })) });

  while (true) {
    if (state.controller.signal.aborted) break;
    const batch = nextBatch(state.tasks, running, concurrency).filter((task) => !started.has(task.id));
    if (batch.length === 0) {
      if (running.size === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 120));
      continue;
    }

    for (const task of batch) {
      started.add(task.id);
      const member = pickAssignee(members, task.role, load);
      if (!member) {
        const index = state.tasks.findIndex((t) => t.id === task.id);
        state.tasks[index] = { ...state.tasks[index]!, status: 'failed', error: 'No member is on duty for this task.' };
        persist(state);
        emit(state, { type: 'task.status', taskId: task.id, status: 'failed' });
        continue;
      }

      const index = state.tasks.findIndex((t) => t.id === task.id);
      state.tasks[index] = {
        ...state.tasks[index]!,
        status: 'running',
        assigneeId: member.id,
        assigneeLabel: member.alias,
        startedAt: nowIso(),
        attempts: state.tasks[index]!.attempts + 1,
      };
      running.add(task.id);
      load.set(member.id, (load.get(member.id) ?? 0) + 1);
      persist(state);
      emit(state, { type: 'task.status', taskId: task.id, status: 'running' });

      void executeTask(state, state.tasks[index]!, member).finally(() => {
        running.delete(task.id);
        load.set(member.id, Math.max(0, (load.get(member.id) ?? 1) - 1));
      });
    }
  }

  while (running.size > 0 && !state.controller.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  if (settings.autoReview && !state.controller.signal.aborted) {
    const reviewer =
      members.find((member) => member.enabled && member.role === 'reviewer') ??
      members.find((member) => member.enabled);
    if (reviewer) await reviewRun(state, reviewer);
  }
}

export async function startRun(input: { prompt: string; workspace?: string }): Promise<RunRecord> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Write what you want done.');

  const settings = getSettings();
  const members = activeMembers();
  if (members.length === 0) throw new Error('No member is on duty. Authorize a provider or a CLI first.');

  const resolved = resolveWorkspace(input.workspace || settings.workspaceRoot);
  if (!resolved.ok) throw new Error(resolved.message ?? 'That workspace cannot be used.');
  mkdirSync(resolved.path, { recursive: true });

  const run: RunRecord = {
    id: newId('run'),
    prompt,
    workspace: resolved.path,
    status: 'queued',
    createdAt: nowIso(),
    stats: { tasks: 0, done: 0, failed: 0, tokensIn: 0, tokensOut: 0, ms: 0 },
  };

  const state: ActiveRun = { run, controller: new AbortController(), seq: 0, tasks: [] };
  active.set(run.id, state);
  writeRun(run);
  emit(state, { type: 'run.status', status: 'queued' });

  void orchestrate(state, members, settings.plannerAssignmentId).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    state.run = { ...state.run, status: 'failed', error: message, finishedAt: nowIso() };
    persist(state);
    emit(state, { type: 'run.status', status: 'failed' });
    emit(state, { type: 'run.done', text: message });
    active.delete(state.run.id);
  });

  return run;
}

async function orchestrate(state: ActiveRun, members: Member[], plannerId?: string): Promise<void> {
  setStatus(state, 'planning');
  const planner = choosePlanner(members, plannerId);
  let plan: PlanResult | undefined;

  if (planner) {
    emit(state, { type: 'run.log', text: `${planner.alias} is planning.` });
    try {
      plan = await makePlan(state.run.prompt, planner, members, state.controller.signal);
    } catch (err) {
      emit(state, {
        type: 'run.log',
        text: `Planning failed, falling back to a fixed plan: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const tasks = plan?.tasks ?? fallbackPlan(state.run.prompt);
  state.tasks = tasks.map((task) => ({
    id: newId('tsk'),
    runId: state.run.id,
    key: task.key,
    title: task.title,
    brief: task.brief,
    acceptance: task.acceptance,
    role: task.role,
    dependsOn: task.dependsOn,
    status: 'pending',
    attempts: 0,
  }));

  if (plan) {
    state.run = {
      ...state.run,
      stats: {
        ...state.run.stats,
        tokensIn: state.run.stats.tokensIn + plan.tokensIn,
        tokensOut: state.run.stats.tokensOut + plan.tokensOut,
      },
    };
  }

  persist(state);
  await drive(state);

  if (state.controller.signal.aborted) {
    state.run = { ...state.run, status: 'cancelled', finishedAt: nowIso() };
    persist(state);
    emit(state, { type: 'run.status', status: 'cancelled' });
    emit(state, { type: 'run.done', text: 'Cancelled.' });
    active.delete(state.run.id);
    return;
  }

  const anyDone = state.tasks.some((task) => task.status === 'done');
  const status: RunStatus = anyDone ? 'done' : 'failed';
  state.run = {
    ...state.run,
    status,
    finishedAt: nowIso(),
    error: anyDone ? undefined : 'Every task failed.',
  };
  persist(state);
  emit(state, { type: 'run.status', status });
  emit(state, { type: 'run.done', text: state.run.summary ?? '' });
  active.delete(state.run.id);
}

export function cancelRun(runId: string): boolean {
  const state = active.get(runId);
  if (!state) return false;
  state.controller.abort();
  return true;
}

export function activeRunIds(): string[] {
  return [...active.keys()];
}

export function closeAllRuns(): void {
  for (const state of active.values()) state.controller.abort();
  active.clear();
}

export function resumeOrphanedRuns(): void {
  for (const run of listRuns(200)) {
    if (run.status !== 'queued' && run.status !== 'planning' && run.status !== 'running' && run.status !== 'reviewing') continue;
    const tasks = readTasks(run.id);
    const patched: RunRecord = {
      ...run,
      status: 'failed',
      finishedAt: nowIso(),
      error: 'The dashboard closed before this run finished.',
    };
    writeRun(patched);
    writeTasks(
      run.id,
      tasks.map((task) =>
        task.status === 'running' || task.status === 'assigned'
          ? { ...task, status: 'skipped' as const, error: 'Interrupted when the dashboard closed.' }
          : task,
      ),
    );
    const ev: RunEvent = {
      seq: 0,
      at: nowIso(),
      runId: run.id,
      type: 'run.status',
      status: 'failed',
      text: 'Interrupted.',
    };
    appendEvent({ ...ev, seq: 1 });
    publish({ ...ev, seq: 1 });
  }
}
