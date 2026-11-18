// Fills a throwaway support folder with plausible data so screens can be reviewed
// without a live provider. Refuses to run against a real HOME.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const home = process.env.HOME;
if (!home || !process.env.ANTI_SL_DEMO) {
  console.error('Refusing to run: set ANTI_SL_DEMO=1 and a temporary HOME.');
  process.exit(1);
}

const support = join(home, 'Library', 'Application Support', 'Anti-Slop-WEHNIT_STUDIOS');
const data = join(support, 'data');
mkdirSync(data, { recursive: true });
mkdirSync(join(support, 'runs'), { recursive: true });
mkdirSync(join(support, 'workspace'), { recursive: true });

const now = Date.now();
const iso = (offsetMs) => new Date(now - offsetMs).toISOString();

const providers = [
  { id: 'prv_openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', flavor: 'openai', builtinId: 'openrouter', headers: {}, hasKey: true, createdAt: iso(86400000 * 9) },
  { id: 'prv_local', label: 'Ollama (this Mac)', baseUrl: 'http://127.0.0.1:11434/v1', flavor: 'openai', builtinId: 'ollama', headers: {}, hasKey: false, createdAt: iso(86400000 * 8) },
];

const models = [
  { id: 'mdl_qwen', providerId: 'prv_openrouter', modelId: 'qwen/qwen3-coder-30b-a3b-instruct:free', label: 'Qwen3 Coder', enabled: true, contextHint: 262144, createdAt: iso(86400000 * 9) },
  { id: 'mdl_llama', providerId: 'prv_openrouter', modelId: 'meta-llama/llama-4-maverick:free', label: 'Llama 4 Maverick', enabled: true, contextHint: 131072, createdAt: iso(86400000 * 9) },
  { id: 'mdl_local', providerId: 'prv_local', modelId: 'qwen2.5-coder:14b', label: 'Qwen 2.5 Coder 14B', enabled: true, contextHint: 32768, createdAt: iso(86400000 * 7) },
];

const harnesses = [
  { id: 'hrn_codex', kind: 'codex', label: 'Codex CLI', command: 'codex', version: '0.48.0', createdAt: iso(86400000 * 6) },
  { id: 'hrn_claude', kind: 'claude', label: 'Claude Code', command: 'claude', version: '2.0.30', createdAt: iso(86400000 * 6) },
];

const harnessModels = [
  { id: 'hmm_codex', harnessId: 'hrn_codex', modelId: 'gpt-5.1-codex', label: 'gpt-5.1-codex', enabled: true, createdAt: iso(86400000 * 6) },
  { id: 'hmm_claude', harnessId: 'hrn_claude', modelId: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5', enabled: true, createdAt: iso(86400000 * 6) },
];

const assignments = [
  { id: 'asg_1', alias: 'qwen', role: 'planner', source: { kind: 'api', modelEntryId: 'mdl_qwen' }, enabled: true, createdAt: iso(86400000 * 5) },
  { id: 'asg_2', alias: 'llama', role: 'builder', source: { kind: 'api', modelEntryId: 'mdl_llama' }, enabled: true, createdAt: iso(86400000 * 5) },
  { id: 'asg_3', alias: 'codex', role: 'builder', source: { kind: 'harness', harnessModelId: 'hmm_codex' }, enabled: true, createdAt: iso(86400000 * 4) },
  { id: 'asg_4', alias: 'sonnet', role: 'reviewer', source: { kind: 'harness', harnessModelId: 'hmm_claude' }, enabled: true, createdAt: iso(86400000 * 4) },
  { id: 'asg_5', alias: 'local-14b', role: 'any', source: { kind: 'api', modelEntryId: 'mdl_local' }, enabled: false, createdAt: iso(86400000 * 3) },
];

const settings = {
  plannerAssignmentId: 'asg_1',
  concurrency: 3,
  autoReview: true,
  workspaceRoot: join(support, 'workspace'),
  theme: 'paper',
  updatedAt: iso(3600000),
};

const write = (name, value) => writeFileSync(join(data, name), JSON.stringify(value, null, 2) + '\n');
write('providers.json', providers);
write('models.json', models);
write('harnesses.json', harnesses);
write('harness-models.json', harnessModels);
write('assignments.json', assignments);
write('settings.json', settings);
writeFileSync(join(support, 'secrets.json'), JSON.stringify({ prv_openrouter: 'sk-or-demo-not-a-real-key' }, null, 2), { mode: 0o600 });

const runs = [
  {
    id: 'run_a1b2c3d4e5f6',
    prompt: 'Add a retry wrapper around the billing client and cover it with tests. Keep the existing call sites unchanged.',
    status: 'done',
    createdOffset: 5400000,
    summary: 'Introduced withRetry in src/billing/retry.ts, applied it to three call sites, added seven tests covering transient and permanent failures.',
    tasks: [
      { key: 't1', title: 'Map the billing call sites', role: 'planner', status: 'done', assignee: 'qwen', ms: 41000 },
      { key: 't2', title: 'Write the retry helper', role: 'builder', status: 'done', assignee: 'codex', ms: 212000 },
      { key: 't3', title: 'Wire up remaining call sites', role: 'builder', status: 'done', assignee: 'llama', ms: 168000 },
      { key: 't4', title: 'Add regression tests', role: 'builder', status: 'done', assignee: 'llama', ms: 121000 },
      { key: 't5', title: 'Review the diff', role: 'reviewer', status: 'done', assignee: 'sonnet', ms: 64000 },
    ],
  },
  {
    id: 'run_b7c8d9e0f1a2',
    prompt: 'The settings page drops the last keystroke when saving quickly. Find it and fix it.',
    status: 'running',
    createdOffset: 240000,
    summary: undefined,
    tasks: [
      { key: 't1', title: 'Reproduce the dropped keystroke', role: 'planner', status: 'done', assignee: 'qwen', ms: 38000 },
      { key: 't2', title: 'Trace the debounce path', role: 'builder', status: 'running', assignee: 'codex', ms: 0 },
      { key: 't3', title: 'Patch and verify', role: 'builder', status: 'pending', assignee: 'llama', ms: 0 },
      { key: 't4', title: 'Review', role: 'reviewer', status: 'pending', assignee: 'sonnet', ms: 0 },
    ],
  },
  {
    id: 'run_c3d4e5f6a7b8',
    prompt: 'Convert the export pipeline from callbacks to async iterators without changing the public API.',
    status: 'failed',
    createdOffset: 86400000,
    summary: undefined,
    tasks: [
      { key: 't1', title: 'Inventory the pipeline', role: 'planner', status: 'done', assignee: 'qwen', ms: 52000 },
      { key: 't2', title: 'Rewrite the reader', role: 'builder', status: 'failed', assignee: 'llama', ms: 90000 },
      { key: 't3', title: 'Rewrite the writer', role: 'builder', status: 'skipped', assignee: 'codex', ms: 0 },
    ],
  },
];

const index = [];
for (const run of runs) {
  const createdAt = iso(run.createdOffset);
  const finished = run.status === 'done' || run.status === 'failed';
  const total = run.tasks.length;
  const done = run.tasks.filter((t) => t.status === 'done').length;
  const failed = run.tasks.filter((t) => t.status === 'failed').length;
  const record = {
    id: run.id,
    prompt: run.prompt,
    workspace: join(support, 'workspace'),
    status: run.status,
    createdAt,
    startedAt: createdAt,
    finishedAt: finished ? iso(run.createdOffset - 300000) : undefined,
    summary: run.summary,
    stats: {
      tasks: total,
      done,
      failed,
      tokensIn: 184320 + total * 2100,
      tokensOut: 24180 + total * 640,
      ms: run.tasks.reduce((acc, t) => acc + t.ms, 0),
    },
  };
  const dir = join(support, 'runs', run.id);
  mkdirSync(dir, { recursive: true });
  const tasks = run.tasks.map((t, i) => ({
    id: 'tsk_' + run.id.slice(-4) + i,
    runId: run.id,
    key: t.key,
    title: t.title,
    brief: t.title,
    acceptance: [],
    role: t.role,
    dependsOn: i === 0 ? [] : [run.tasks[i - 1].key],
    assigneeId: t.assignee,
    assigneeLabel: t.assignee,
    status: t.status,
    attempts: 1,
    startedAt: t.ms ? createdAt : undefined,
    finishedAt: t.ms ? new Date(new Date(createdAt).getTime() + t.ms).toISOString() : undefined,
    output: t.status === 'done' ? t.title + ': done.' : undefined,
    error: t.status === 'failed' ? 'Provider returned 429 after two attempts.' : undefined,
  }));
  writeFileSync(join(dir, 'run.json'), JSON.stringify(record, null, 2) + '\n');
  writeFileSync(join(dir, 'tasks.json'), JSON.stringify(tasks, null, 2) + '\n');
  const lines = [];
  let seq = 1;
  for (const task of tasks) {
    lines.push(JSON.stringify({ seq: seq++, at: createdAt, runId: run.id, taskId: task.id, type: 'task.status', status: task.status }));
  }
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n');
  index.push(record);
}
writeFileSync(join(support, 'runs', 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log('seeded', support);
