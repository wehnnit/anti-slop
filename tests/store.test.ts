import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let originalHome: string | undefined;
let sandbox: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  sandbox = mkdtempSync(join(tmpdir(), 'anti-sl-store-'));
  process.env.HOME = sandbox;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

async function loadStore() {
  return import('../src/store/index.js');
}

describe('support folder', () => {
  it('lives under Application Support with the product name', async () => {
    const store = await loadStore();
    expect(store.rootPath()).toContain('Application Support');
    expect(store.rootPath().endsWith('Anti-Slop-WEHNIT_STUDIOS')).toBe(true);
  });

  it('reports installed only when the folder exists', async () => {
    const store = await loadStore();
    expect(store.isInstalled()).toBe(false);
    store.ensureLayout();
    expect(store.isInstalled()).toBe(true);
  });

  it('keeps secrets in a locked file', async () => {
    const store = await loadStore();
    store.ensureLayout();
    store.setProviderSecret('prv_one', 'sk-test-123');
    expect(store.providerSecret('prv_one')).toBe('sk-test-123');
    const mode = statSync(join(store.rootPath(), 'secrets.json')).mode & 0o777;
    expect(mode).toBe(0o600);
    store.setProviderSecret('prv_one', null);
    expect(store.providerSecret('prv_one')).toBeUndefined();
  });
});

describe('collections', () => {
  it('round-trips a provider record', async () => {
    const store = await loadStore();
    store.ensureLayout();
    const provider = {
      id: store.newId('prv'),
      label: 'Local gateway',
      baseUrl: 'http://127.0.0.1:8080/v1',
      flavor: 'openai' as const,
      headers: { 'x-route': 'fast' },
      hasKey: false,
      createdAt: store.nowIso(),
    };
    store.writeCollection('providers', [provider]);
    expect(store.listProviders()).toEqual([provider]);
  });

  it('starts from defaults when settings are absent', async () => {
    const store = await loadStore();
    store.ensureLayout();
    const settings = store.getSettings();
    expect(settings.concurrency).toBeGreaterThan(0);
    expect(settings.workspaceRoot.length).toBeGreaterThan(0);
    expect(['paper', 'ink']).toContain(settings.theme);
  });

  it('creates unique ids with the requested prefix', async () => {
    const store = await loadStore();
    const ids = new Set(Array.from({ length: 50 }, () => store.newId('run')));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.startsWith('run_')).toBe(true);
  });
});

describe('runs', () => {
  it('writes a run and reads it back through the index', async () => {
    const store = await loadStore();
    store.ensureLayout();
    const run = {
      id: store.newId('run'),
      prompt: 'Tidy the release script',
      workspace: join(sandbox, 'work'),
      status: 'queued' as const,
      createdAt: store.nowIso(),
      stats: { tasks: 0, done: 0, failed: 0, tokensIn: 0, tokensOut: 0, ms: 0 },
    };
    store.writeRun(run);
    expect(store.readRun(run.id)).toEqual(run);
    expect(store.listRuns()).toHaveLength(1);
  });

  it('appends events and filters by since', async () => {
    const store = await loadStore();
    store.ensureLayout();
    const runId = store.newId('run');
    for (let seq = 1; seq <= 4; seq += 1) {
      store.appendEvent({ seq, at: store.nowIso(), runId, type: 'run.log', text: `line ${seq}` });
    }
    expect(store.readEvents(runId)).toHaveLength(4);
    expect(store.readEvents(runId, 2).map((ev) => ev.seq)).toEqual([3, 4]);
  });

  it('drops a torn trailing line instead of throwing', async () => {
    const store = await loadStore();
    store.ensureLayout();
    const runId = store.newId('run');
    store.appendEvent({ seq: 1, at: store.nowIso(), runId, type: 'run.log', text: 'ok' });
    appendFileSync(join(store.runDir(runId), 'events.jsonl'), '{"seq":2,"runId":');
    expect(store.readEvents(runId)).toHaveLength(1);
  });

  it('removes the run folder on delete', async () => {
    const store = await loadStore();
    store.ensureLayout();
    const run = {
      id: store.newId('run'),
      prompt: 'x',
      workspace: sandbox,
      status: 'done' as const,
      createdAt: store.nowIso(),
      stats: { tasks: 0, done: 0, failed: 0, tokensIn: 0, tokensOut: 0, ms: 0 },
    };
    store.writeRun(run);
    store.deleteRun(run.id);
    expect(existsSync(store.runDir(run.id))).toBe(false);
    expect(store.readRun(run.id)).toBeUndefined();
  });
});

describe('workspace guard', () => {
  it('accepts an absolute folder outside the support root', async () => {
    const store = await loadStore();
    const result = store.resolveWorkspace(join(sandbox, 'projects', 'app'));
    expect(result.ok).toBe(true);
    expect(result.path.startsWith('/')).toBe(true);
  });

  it('rejects state folders inside the support root', async () => {
    const store = await loadStore();
    for (const inside of ['data', 'runs', 'bin']) {
      const rejected = store.resolveWorkspace(join(store.rootPath(), inside));
      expect(rejected.ok).toBe(false);
      expect(rejected.message).toMatch(/support folder/i);
    }
    expect(store.resolveWorkspace(store.rootPath()).ok).toBe(false);
  });

  it('allows the scratch folder it ships with', async () => {
    const store = await loadStore();
    const accepted = store.resolveWorkspace(join(store.rootPath(), 'workspace'));
    expect(accepted.ok).toBe(true);
  });

  it('rejects empty input', async () => {
    const store = await loadStore();
    expect(store.resolveWorkspace('   ').ok).toBe(false);
  });

  it('expands a leading tilde', async () => {
    const store = await loadStore();
    const result = store.resolveWorkspace('~/code');
    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(sandbox, 'code'));
  });
});
