import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Assignment,
  HarnessModel,
  HarnessRecord,
  ModelEntry,
  ProviderRecord,
  RunEvent,
  RunRecord,
  Settings,
  TaskRecord,
} from '../types.js';
import { dataDir, defaultWorkspace, runsDir, secretsPath, supportRoot } from './paths.js';
import { appendLine, readJson, removeFile, writeJson } from './json.js';

export const VERSION = '0.1.0';

export function rootPath(): string {
  return supportRoot();
}

export function isInstalled(): boolean {
  return existsSync(supportRoot());
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const defaultSettings = (): Settings => ({
  concurrency: 3,
  autoReview: true,
  workspaceRoot: defaultWorkspace(),
  theme: 'paper',
  updatedAt: nowIso(),
});

interface Collections {
  providers: ProviderRecord[];
  models: ModelEntry[];
  harnesses: HarnessRecord[];
  harnessModels: HarnessModel[];
  assignments: Assignment[];
  settings: Settings;
}

const collectionFile: Record<keyof Collections, string> = {
  providers: 'providers.json',
  models: 'models.json',
  harnesses: 'harnesses.json',
  harnessModels: 'harness-models.json',
  assignments: 'assignments.json',
  settings: 'settings.json',
};

export function readCollection<K extends keyof Collections>(name: K): Collections[K] {
  const path = join(dataDir(), collectionFile[name]);
  if (name === 'settings') {
    return { ...defaultSettings(), ...readJson<Partial<Settings>>(path, {}) } as Collections[K];
  }
  return readJson<Collections[K]>(path, [] as unknown as Collections[K]);
}

export function writeCollection<K extends keyof Collections>(name: K, value: Collections[K]): void {
  writeJson(join(dataDir(), collectionFile[name]), value);
}

export function listProviders(): ProviderRecord[] {
  return readCollection('providers');
}

export function getProvider(id: string): ProviderRecord | undefined {
  return listProviders().find((p) => p.id === id);
}

export function listModels(): ModelEntry[] {
  return readCollection('models');
}

export function listHarnesses(): HarnessRecord[] {
  return readCollection('harnesses');
}

export function listHarnessModels(): HarnessModel[] {
  return readCollection('harnessModels');
}

export function listAssignments(): Assignment[] {
  return readCollection('assignments');
}

export function getSettings(): Settings {
  return readCollection('settings');
}

type SecretMap = Record<string, string>;

function readSecrets(): SecretMap {
  return readJson<SecretMap>(secretsPath(), {});
}

export function providerSecret(providerId: string): string | undefined {
  return readSecrets()[providerId];
}

export function setProviderSecret(providerId: string, key: string | null): void {
  const secrets = readSecrets();
  if (key === null || key === '') {
    delete secrets[providerId];
  } else {
    secrets[providerId] = key;
  }
  writeJson(secretsPath(), secrets, 0o600);
}

export function runsRoot(): string {
  return runsDir();
}

export function runDir(runId: string): string {
  return join(runsDir(), runId);
}

export function ensureRunDir(runId: string): string {
  const dir = runDir(runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeRun(run: RunRecord): void {
  writeJson(join(ensureRunDir(run.id), 'run.json'), run);
  const index = readRunIndex().filter((r) => r.id !== run.id);
  index.push(run);
  writeJson(join(runsRoot(), 'index.json'), index);
}

function readRunIndex(): RunRecord[] {
  return readJson<RunRecord[]>(join(runsRoot(), 'index.json'), []);
}

export function readRun(runId: string): RunRecord | undefined {
  const direct = readJson<RunRecord | null>(join(runDir(runId), 'run.json'), null);
  if (direct) return direct;
  return readRunIndex().find((r) => r.id === runId);
}

export function listRuns(limit = 50): RunRecord[] {
  const index = readRunIndex();
  if (index.length > 0) {
    return index
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  if (!existsSync(runsRoot())) return [];
  return readdirSync(runsRoot())
    .filter((name) => {
      try {
        return statSync(join(runsRoot(), name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((name) => readRun(name))
    .filter((r): r is RunRecord => Boolean(r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function writeTasks(runId: string, tasks: TaskRecord[]): void {
  writeJson(join(ensureRunDir(runId), 'tasks.json'), tasks);
}

export function readTasks(runId: string): TaskRecord[] {
  return readJson<TaskRecord[]>(join(runDir(runId), 'tasks.json'), []);
}

export function appendEvent(ev: RunEvent): void {
  appendLine(join(ensureRunDir(ev.runId), 'events.jsonl'), JSON.stringify(ev));
}

export function readEvents(runId: string, sinceSeq = 0): RunEvent[] {
  const path = join(runDir(runId), 'events.jsonl');
  if (!existsSync(path)) return [];
  const raw = readJsonRaw(path);
  const out: RunEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as RunEvent;
      if (ev.seq > sinceSeq) out.push(ev);
    } catch {
      /* torn tail line */
    }
  }
  return out;
}

function readJsonRaw(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function deleteRun(runId: string): void {
  const index = readRunIndex().filter((r) => r.id !== runId);
  writeJson(join(runsRoot(), 'index.json'), index);
  const dir = runDir(runId);
  if (!dir.startsWith(runsRoot() + sep)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export function resolveWorkspace(input: string): { ok: boolean; path: string; message?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, path: '', message: 'Workspace path is empty.' };
  const expanded = trimmed.startsWith('~') ? join(homedir(), trimmed.slice(1)) : trimmed;
  const absolute = resolve(expanded);
  if (!absolute.startsWith(sep)) {
    return { ok: false, path: '', message: 'Workspace must be an absolute path.' };
  }
  // The shipped scratch folder is the one place inside the support root that runs
  // may write to. Everything else there is state the user should not point at.
  if (absolute === defaultWorkspace()) {
    return { ok: true, path: absolute };
  }
  if (absolute === rootPath() || absolute.startsWith(rootPath() + sep)) {
    return { ok: false, path: absolute, message: 'Pick a folder outside the Anti-Slop support folder.' };
  }
  return { ok: true, path: absolute };
}

export function ensureLayout(): void {
  mkdirSync(dataDir(), { recursive: true });
  mkdirSync(runsRoot(), { recursive: true });
  if (!existsSync(join(dataDir(), 'settings.json'))) {
    writeCollection('settings', defaultSettings());
  }
  mkdirSync(getSettings().workspaceRoot, { recursive: true });
}

export function listDirectories(target: string): { path: string; parent: string; dirs: { name: string; path: string }[] } {
  const resolved = resolve(target);
  const entries = existsSync(resolved) ? readdirSync(resolved, { withFileTypes: true }) : [];
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: join(resolved, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = resolved === sep ? sep : resolve(resolved, '..');
  return { path: resolved, parent, dirs };
}

export { removeFile };
