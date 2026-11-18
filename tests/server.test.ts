import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunningServer } from '../src/server/index.js';

let sandbox: string;
let originalHome: string | undefined;
let server: RunningServer;

beforeAll(async () => {
  originalHome = process.env.HOME;
  sandbox = mkdtempSync(join(tmpdir(), 'anti-sl-server-'));
  process.env.HOME = sandbox;
  const store = await import('../src/store/index.js');
  store.ensureLayout();
  const { createDashboardServer } = await import('../src/server/index.js');
  server = await createDashboardServer({ port: 0 });
});

afterAll(async () => {
  await server.close();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${server.url}${path}`, init);
}

function authed(path: string, method: string, body?: unknown): Promise<Response> {
  return call(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-anti-sl-token': server.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('health and shell', () => {
  it('answers health without a token', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; root: string };
    expect(body.ok).toBe(true);
    expect(body.root).toContain('Anti-Slop-WEHNIT_STUDIOS');
  });

  it('serves the shell with a session token injected', async () => {
    const res = await call('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('__ANTI_SL__');
    expect(html).toContain(server.token);
  });

  it('returns 404 for an unknown page', async () => {
    const res = await call('/nope');
    expect(res.status).toBe(404);
  });
});

describe('write protection', () => {
  it('rejects a mutating request without the token', async () => {
    const res = await call('/api/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'x', baseUrl: 'https://example.test/v1', flavor: 'openai' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a cross-origin browser request', async () => {
    const res = await call('/api/health', { headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });
});

describe('providers and models', () => {
  it('creates a provider and never returns its key', async () => {
    const res = await authed('/api/providers', 'POST', {
      label: 'Gateway',
      baseUrl: 'https://router.example/v1',
      flavor: 'openai',
      apiKey: 'sk-secret',
    });
    expect(res.status).toBe(201);
    const provider = (await res.json()) as { id: string; hasKey: boolean };
    expect(provider.hasKey).toBe(true);
    expect(JSON.stringify(provider)).not.toContain('sk-secret');
    expect(JSON.stringify(await (await call('/api/providers')).json())).not.toContain('sk-secret');
  });

  it('validates the base URL', async () => {
    const res = await authed('/api/providers', 'POST', {
      label: 'Bad',
      baseUrl: 'router.example',
      flavor: 'openai',
    });
    expect(res.status).toBe(400);
  });

  it('refuses duplicate base URLs for the same flavor', async () => {
    const body = { label: 'Dup', baseUrl: 'https://router.example/v1', flavor: 'openai' };
    expect((await authed('/api/providers', 'POST', body)).status).toBe(400);
  });

  it('rejects an unknown flavor', async () => {
    const res = await authed('/api/providers', 'POST', {
      label: 'Odd',
      baseUrl: 'https://odd.example/v1',
      flavor: 'gemini',
    });
    expect(res.status).toBe(400);
  });

  it('cascades model deletion into assignments', async () => {
    const provider = (await (
      await authed('/api/providers', 'POST', { label: 'P', baseUrl: 'https://p.example/v1', flavor: 'openai' })
    ).json()) as { id: string };
    const model = (await (
      await authed('/api/models', 'POST', { providerId: provider.id, modelId: 'acme/alpha' })
    ).json()) as { id: string };
    expect(
      (
        await authed('/api/assignments', 'POST', {
          source: { kind: 'api', modelEntryId: model.id },
          role: 'builder',
        })
      ).status,
    ).toBe(201);
    expect((await authed(`/api/models/${model.id}`, 'DELETE')).status).toBe(200);
    const names = ((await (await call('/api/assignments')).json()) as { alias: string }[]).map((a) => a.alias);
    expect(names).not.toContain('alpha');
  });
});

describe('runs', () => {
  it('rejects an empty prompt', async () => {
    const res = await authed('/api/runs', 'POST', { prompt: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a workspace inside the support folder', async () => {
    const res = await authed('/api/runs', 'POST', {
      prompt: 'do the thing',
      workspace: join(sandbox, 'Library', 'Application Support', 'Anti-Slop-WEHNIT_STUDIOS'),
    });
    expect(res.status).toBe(400);
  });

  it('404s on an unknown run', async () => {
    expect((await call('/api/runs/run_missing')).status).toBe(404);
  });
});

describe('settings', () => {
  it('accepts a value inside the range and rejects one outside it', async () => {
    const ok = await authed('/api/settings', 'PUT', { concurrency: 4 });
    expect(((await ok.json()) as { concurrency: number }).concurrency).toBe(4);
    expect((await authed('/api/settings', 'PUT', { concurrency: 40 })).status).toBe(400);
  });

  it('rejects an unknown theme', async () => {
    expect((await authed('/api/settings', 'PUT', { theme: 'neon' })).status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await call('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-anti-sl-token': server.token },
      body: '{nope',
    });
    expect(res.status).toBe(400);
  });
});

describe('filesystem browser', () => {
  it('lists directories only', async () => {
    const res = await call(`/api/fs?path=${encodeURIComponent(sandbox)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; dirs: { name: string }[] };
    expect(body.path).toBe(sandbox);
    expect(Array.isArray(body.dirs)).toBe(true);
  });
});

describe('project folders', () => {
  it('saves, lists, renames and forgets a project folder', async () => {
    const project = join(sandbox, 'clients', 'atlas');
    mkdirSync(project, { recursive: true });

    const created = await authed('/api/projects', 'POST', { path: project });
    expect(created.status).toBe(201);
    const saved = (await created.json()) as { id: string; label: string; path: string };
    expect(saved.path).toBe(project);
    expect(saved.label).toBe('atlas');

    const listed = (await (await call('/api/projects')).json()) as { id: string }[];
    expect(listed.map((item) => item.id)).toContain(saved.id);

    const renamed = await authed(`/api/projects/${saved.id}`, 'PATCH', { label: 'Atlas' });
    expect(((await renamed.json()) as { label: string }).label).toBe('Atlas');

    const dropped = await authed(`/api/projects/${saved.id}`, 'DELETE');
    expect(dropped.status).toBe(200);
    const after = (await (await call('/api/projects')).json()) as { id: string }[];
    expect(after.map((item) => item.id)).not.toContain(saved.id);
  });

  it('returns the same record when a folder is already saved', async () => {
    const project = join(sandbox, 'clients', 'atlas');
    mkdirSync(project, { recursive: true });
    const first = (await (await authed('/api/projects', 'POST', { path: project })).json()) as { id: string };
    const second = (await (await authed('/api/projects', 'POST', { path: project })).json()) as { id: string };
    expect(second.id).toBe(first.id);
  });

  it('refuses a folder inside the support directory', async () => {
    const store = await import('../src/store/index.js');
    const res = await authed('/api/projects', 'POST', { path: join(store.rootPath(), 'secrets.json') });
    expect(res.status).toBe(400);
  });

  it('offers common places and marks project folders in a listing', async () => {
    const places = (await (await call('/api/fs/places')).json()) as { home: { name: string; path: string }[] };
    expect(places.home.some((entry) => entry.path === sandbox)).toBe(true);

    mkdirSync(join(sandbox, 'checkout', '.git'), { recursive: true });
    const listing = (await (await call(`/api/fs?path=${encodeURIComponent(sandbox)}`)).json()) as {
      looksLikeProject: boolean;
      dirs: { name: string; looksLikeProject: boolean }[];
    };
    expect(listing.looksLikeProject).toBe(false);
    expect(listing.dirs.find((dir) => dir.name === 'checkout')?.looksLikeProject).toBe(true);
  });

  it('keeps hidden folders out unless they are asked for', async () => {
    mkdirSync(join(sandbox, 'visible'), { recursive: true });
    mkdirSync(join(sandbox, '.dotfolder'), { recursive: true });
    const plain = (await (await call(`/api/fs?path=${encodeURIComponent(sandbox)}`)).json()) as {
      dirs: { name: string }[];
      hiddenCount: number;
    };
    expect(plain.dirs.map((dir) => dir.name)).not.toContain('.dotfolder');
    expect(plain.hiddenCount).toBeGreaterThan(0);

    const wide = (await (await call(`/api/fs?path=${encodeURIComponent(sandbox)}&hidden=1`)).json()) as {
      dirs: { name: string }[];
    };
    expect(wide.dirs.map((dir) => dir.name)).toContain('.dotfolder');
  });
});

describe('the project folder in use', () => {
  it('remembers the chosen folder and moves the workspace with it', async () => {
    const project = join(sandbox, 'clients', 'atlas');
    mkdirSync(project, { recursive: true });
    const saved = (await (await authed('/api/projects', 'POST', { path: project })).json()) as { id: string };

    const updated = await authed('/api/settings', 'PUT', { activeProjectId: saved.id });
    expect(updated.status).toBe(200);
    const settings = (await updated.json()) as { activeProjectId?: string; workspaceRoot: string };
    expect(settings.activeProjectId).toBe(saved.id);
    expect(settings.workspaceRoot).toBe(project);

    const overview = (await (await call('/api/overview')).json()) as {
      settings: { activeProjectId?: string };
      projects: { id: string }[];
    };
    expect(overview.settings.activeProjectId).toBe(saved.id);
    expect(overview.projects.map((item) => item.id)).toContain(saved.id);
  });

  it('refuses a project id that is not saved', async () => {
    const res = await authed('/api/settings', 'PUT', { activeProjectId: 'prj_gone' });
    expect(res.status).toBe(400);
  });

  it('forgets the folder in use when its record is deleted', async () => {
    const project = join(sandbox, 'clients', 'teardown');
    mkdirSync(project, { recursive: true });
    const saved = (await (await authed('/api/projects', 'POST', { path: project })).json()) as { id: string };
    await authed('/api/settings', 'PUT', { activeProjectId: saved.id });

    await authed(`/api/projects/${saved.id}`, 'DELETE');
    const settings = (await (await call('/api/settings')).json()) as { activeProjectId?: string };
    expect(settings.activeProjectId).toBeUndefined();
  });
});
