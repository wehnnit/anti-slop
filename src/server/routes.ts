import type {
  Assignment,
  DetectionEntry,
  HarnessModel,
  HarnessRecord,
  HarnessKind,
  ModelEntry,
  ProjectRecord,
  ProviderFlavor,
  ProviderRecord,
  RunRecord,
  Settings,
  TeamRole,
} from '../types.js';
import type { TeamMemberView } from '../engine/team.js';
import { Router } from './router.js';
import { bad, bool, int, notFound, optStr, record, str } from './http.js';
import type { Ctx } from './http.js';
import {
  VERSION,
  getProject,
  getSettings,
  listAssignments,
  listDirectories,
  listHarnesses,
  listHarnessModels,
  listModels,
  listProjects,
  listProviders,
  listRuns,
  deleteRun,
  newId,
  nowIso,
  providerSecret,
  readEvents,
  readRun,
  readTasks,
  resolveWorkspace,
  rootPath,
  setProviderSecret,
  writeCollection,
  writeProjects,
  commonPlaces,
} from '../store/index.js';
import { cancelRun, listTeam, startRun } from '../engine/index.js';
import { detectHarnesses } from '../harnesses/detect.js';
import { testProvider } from '../providers/index.js';

export interface Overview {
  version: string;
  root: string;
  counts: {
    providers: number;
    models: number;
    harnesses: number;
    harnessModels: number;
    assignments: number;
    runs: number;
  };
  readiness: { hasTeam: boolean; hasPlanner: boolean; hasWorkspace: boolean };
  settings: Settings;
  recentRuns: RunRecord[];
  team: TeamMemberView[];
  projects: ProjectRecord[];
}

const flavors: ProviderFlavor[] = ['openai', 'anthropic'];
const harnessKinds: HarnessKind[] = ['codex', 'claude', 'opencode', 'hermes', 'cursor', 'deepai', 'custom'];
const roles: TeamRole[] = ['planner', 'builder', 'reviewer', 'any'];

function pickFlavor(input: unknown, fallback: ProviderFlavor = 'openai'): ProviderFlavor {
  if (input === undefined) return fallback;
  if (typeof input !== 'string' || !flavors.includes(input as ProviderFlavor)) {
    throw bad('Provider flavor must be "openai" or "anthropic".');
  }
  return input as ProviderFlavor;
}

function pickKind(input: unknown): HarnessKind {
  if (typeof input !== 'string' || !harnessKinds.includes(input as HarnessKind)) {
    throw bad('Unknown harness kind.');
  }
  return input as HarnessKind;
}

function pickRole(input: unknown): TeamRole {
  if (input === undefined) return 'any';
  if (typeof input !== 'string' || !roles.includes(input as TeamRole)) {
    throw bad('Role must be planner, builder, reviewer, or any.');
  }
  return input as TeamRole;
}

function requireProvider(id: string): ProviderRecord {
  const found = listProviders().find((p) => p.id === id);
  if (!found) throw notFound('Provider');
  return found;
}

function requireModel(id: string): ModelEntry {
  const found = listModels().find((m) => m.id === id);
  if (!found) throw notFound('Model');
  return found;
}

function requireHarness(id: string): HarnessRecord {
  const found = listHarnesses().find((h) => h.id === id);
  if (!found) throw notFound('Harness');
  return found;
}

function requireHarnessModel(id: string): HarnessModel {
  const found = listHarnessModels().find((m) => m.id === id);
  if (!found) throw notFound('Harness model');
  return found;
}

function requireAssignment(id: string): Assignment {
  const found = listAssignments().find((a) => a.id === id);
  if (!found) throw notFound('Assignment');
  return found;
}

function aliasTaken(alias: string, exceptId?: string): boolean {
  return listAssignments().some((a) => a.alias.toLowerCase() === alias.toLowerCase() && a.id !== exceptId);
}

function deriveAlias(base: string): string {
  const cleaned = base.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'member';
  let candidate = cleaned;
  let n = 2;
  while (aliasTaken(candidate)) {
    candidate = `${cleaned}-${n}`;
    n += 1;
  }
  return candidate;
}

function providerView(p: ProviderRecord): ProviderRecord {
  return { ...p, hasKey: Boolean(providerSecret(p.id)) };
}

export const router = new Router()
  .get('/api/health', () => ({ ok: true, version: VERSION, root: rootPath() }))
  .get('/api/overview', (): Overview => {
    const settings = getSettings();
    const team = listTeam();
    const runs = listRuns(200);
    return {
      version: VERSION,
      root: rootPath(),
      counts: {
        providers: listProviders().length,
        models: listModels().length,
        harnesses: listHarnesses().length,
        harnessModels: listHarnessModels().length,
        assignments: listAssignments().length,
        runs: runs.length,
      },
      readiness: {
        hasTeam: team.some((member) => member.enabled),
        hasPlanner: Boolean(settings.plannerAssignmentId),
        hasWorkspace: Boolean(settings.workspaceRoot),
      },
      settings,
      recentRuns: runs.slice(0, 6),
      team,
      projects: listProjects(),
    };
  })
  .get('/api/providers', () => listProviders().map(providerView))
  .post('/api/providers', (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const label = str(body.label, 'Label', 80);
    const baseUrl = str(body.baseUrl, 'Base URL', 400);
    if (!/^https?:\/\//i.test(baseUrl)) throw bad('Base URL must start with http:// or https://.');
    const flavor = pickFlavor(body.flavor);
    const headers = record(body.headers, 'headers');
    const existing = listProviders().find(
      (p) => p.baseUrl.replace(/\/$/, '') === baseUrl.replace(/\/$/, '') && p.flavor === flavor,
    );
    if (existing) throw bad('A provider with that base URL and flavor already exists.');
    const provider: ProviderRecord = {
      id: newId('prv'),
      label,
      baseUrl: baseUrl.replace(/\/$/, ''),
      flavor,
      builtinId: optStr(body.builtinId, 'Preset', 40),
      headers,
      hasKey: false,
      createdAt: nowIso(),
    };
    const key = optStr(body.apiKey, 'API key', 4000);
    if (key) setProviderSecret(provider.id, key);
    writeCollection('providers', [...listProviders(), provider]);
    return providerView(provider);
  })
  .patch('/api/providers/:id', (ctx) => {
    const provider = requireProvider(ctx.params.id!);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const next: ProviderRecord = { ...provider };
    if (body.label !== undefined) next.label = str(body.label, 'Label', 80);
    if (body.baseUrl !== undefined) {
      const baseUrl = str(body.baseUrl, 'Base URL', 400);
      if (!/^https?:\/\//i.test(baseUrl)) throw bad('Base URL must start with http:// or https://.');
      next.baseUrl = baseUrl.replace(/\/$/, '');
    }
    next.flavor = pickFlavor(body.flavor, provider.flavor);
    if (body.headers !== undefined) next.headers = record(body.headers, 'headers');
    if (body.apiKey !== undefined) setProviderSecret(provider.id, optStr(body.apiKey, 'API key', 4000) ?? null);
    writeCollection('providers', listProviders().map((p) => (p.id === provider.id ? next : p)));
    return providerView(next);
  })
  .delete('/api/providers/:id', (ctx) => {
    const provider = requireProvider(ctx.params.id!);
    const modelIds = new Set(listModels().filter((m) => m.providerId === provider.id).map((m) => m.id));
    const assignmentIds = new Set(
      listAssignments()
        .filter((a) => a.source.kind === 'api' && modelIds.has(a.source.modelEntryId))
        .map((a) => a.id),
    );
    writeCollection('providers', listProviders().filter((p) => p.id !== provider.id));
    writeCollection('models', listModels().filter((m) => m.providerId !== provider.id));
    writeCollection('assignments', listAssignments().filter((a) => !assignmentIds.has(a.id)));
    setProviderSecret(provider.id, null);
    return { ok: true };
  })
  .post('/api/providers/:id/test', async (ctx) => {
    const provider = requireProvider(ctx.params.id!);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const modelId = optStr(body.modelId, 'Model ID', 200) ?? listModels().find((m) => m.providerId === provider.id)?.modelId;
    const apiKey = optStr(body.apiKey, 'API key', 4000) ?? providerSecret(provider.id);
    return testProvider(providerView(provider), apiKey, modelId);
  })
  .post('/api/providers/test', async (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const baseUrl = str(body.baseUrl, 'Base URL', 400);
    if (!/^https?:\/\//i.test(baseUrl)) throw bad('Base URL must start with http:// or https://.');
    const draft: ProviderRecord = {
      id: 'draft',
      label: optStr(body.label, 'Label', 80) ?? 'Draft',
      baseUrl: baseUrl.replace(/\/$/, ''),
      flavor: pickFlavor(body.flavor),
      headers: record(body.headers, 'headers'),
      hasKey: false,
      createdAt: nowIso(),
    };
    return testProvider(draft, optStr(body.apiKey, 'API key', 4000), optStr(body.modelId, 'Model ID', 200));
  })
  .get('/api/providers/:id/models', (ctx) => {
    const provider = requireProvider(ctx.params.id!);
    return listModels().filter((m) => m.providerId === provider.id);
  })
  .post('/api/models', (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const provider = requireProvider(str(body.providerId, 'Provider', 80));
    const modelId = str(body.modelId, 'Model ID', 200);
    if (listModels().some((m) => m.providerId === provider.id && m.modelId === modelId)) {
      throw bad('That model ID is already authorized for this provider.');
    }
    const entry: ModelEntry = {
      id: newId('mdl'),
      providerId: provider.id,
      modelId,
      label: optStr(body.label, 'Label', 80) ?? modelId,
      contextHint: body.contextHint === undefined ? undefined : int(body.contextHint, 'Context hint', 1000, 10_000_000, 0),
      enabled: bool(body.enabled, 'Enabled', true),
      createdAt: nowIso(),
    };
    writeCollection('models', [...listModels(), entry]);
    return entry;
  })
  .patch('/api/models/:id', (ctx) => {
    const entry = requireModel(ctx.params.id!);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const next: ModelEntry = { ...entry };
    if (body.label !== undefined) next.label = str(body.label, 'Label', 80);
    if (body.modelId !== undefined) next.modelId = str(body.modelId, 'Model ID', 200);
    if (body.enabled !== undefined) next.enabled = bool(body.enabled, 'Enabled', entry.enabled);
    if (body.contextHint !== undefined) {
      next.contextHint = int(body.contextHint, 'Context hint', 1000, 10_000_000, entry.contextHint ?? 0);
    }
    writeCollection('models', listModels().map((m) => (m.id === entry.id ? next : m)));
    return next;
  })
  .delete('/api/models/:id', (ctx) => {
    const entry = requireModel(ctx.params.id!);
    writeCollection('models', listModels().filter((m) => m.id !== entry.id));
    writeCollection(
      'assignments',
      listAssignments().filter((a) => !(a.source.kind === 'api' && a.source.modelEntryId === entry.id)),
    );
    return { ok: true };
  })
  .get('/api/harnesses/detect', async (): Promise<DetectionEntry[]> => {
    const detected = await detectHarnesses();
    const existing = listHarnesses();
    return detected.map((d) => ({ ...d, installed: d.installed && !existing.some((h) => h.kind === d.kind) }));
  })
  .get('/api/harnesses', () => listHarnesses())
  .post('/api/harnesses', (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const kind = pickKind(body.kind);
    if (listHarnesses().some((h) => h.kind === kind)) throw bad('That harness is already connected.');
    const harness: HarnessRecord = {
      id: newId('hrn'),
      kind,
      label: str(body.label, 'Label', 80),
      command: str(body.command, 'Command', 400),
      argsTemplate: optStr(body.argsTemplate, 'Arguments template', 600),
      version: optStr(body.version, 'Version', 80),
      mode: body.mode === 'session' ? 'session' : 'headless',
      location: optStr(body.location, 'Location', 600),
      createdAt: nowIso(),
    };
    writeCollection('harnesses', [...listHarnesses(), harness]);
    return harness;
  })
  .patch('/api/harnesses/:id', (ctx) => {
    const harness = requireHarness(ctx.params.id!);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const next: HarnessRecord = { ...harness };
    if (body.label !== undefined) next.label = str(body.label, 'Label', 80);
    if (body.command !== undefined) next.command = str(body.command, 'Command', 400);
    if (body.argsTemplate !== undefined) next.argsTemplate = optStr(body.argsTemplate, 'Arguments template', 600);
    writeCollection('harnesses', listHarnesses().map((h) => (h.id === harness.id ? next : h)));
    return next;
  })
  .delete('/api/harnesses/:id', (ctx) => {
    const harness = requireHarness(ctx.params.id!);
    const modelIds = new Set(listHarnessModels().filter((m) => m.harnessId === harness.id).map((m) => m.id));
    writeCollection('harnesses', listHarnesses().filter((h) => h.id !== harness.id));
    writeCollection('harnessModels', listHarnessModels().filter((m) => m.harnessId !== harness.id));
    writeCollection(
      'assignments',
      listAssignments().filter((a) => !(a.source.kind === 'harness' && modelIds.has(a.source.harnessModelId))),
    );
    return { ok: true };
  })
  .get('/api/harness-models', () => listHarnessModels())
  .post('/api/harness-models', (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const harness = requireHarness(str(body.harnessId, 'Harness', 80));
    const modelId = str(body.modelId, 'Model ID', 200);
    if (listHarnessModels().some((m) => m.harnessId === harness.id && m.modelId === modelId)) {
      throw bad('That model ID is already authorized for this harness.');
    }
    const entry: HarnessModel = {
      id: newId('hmm'),
      harnessId: harness.id,
      modelId,
      label: optStr(body.label, 'Label', 80) ?? modelId,
      enabled: bool(body.enabled, 'Enabled', true),
      createdAt: nowIso(),
    };
    writeCollection('harnessModels', [...listHarnessModels(), entry]);
    return entry;
  })
  .patch('/api/harness-models/:id', (ctx) => {
    const entry = requireHarnessModel(ctx.params.id!);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const next: HarnessModel = { ...entry };
    if (body.label !== undefined) next.label = str(body.label, 'Label', 80);
    if (body.modelId !== undefined) next.modelId = str(body.modelId, 'Model ID', 200);
    if (body.enabled !== undefined) next.enabled = bool(body.enabled, 'Enabled', entry.enabled);
    writeCollection('harnessModels', listHarnessModels().map((m) => (m.id === entry.id ? next : m)));
    return next;
  })
  .delete('/api/harness-models/:id', (ctx) => {
    const entry = requireHarnessModel(ctx.params.id!);
    writeCollection('harnessModels', listHarnessModels().filter((m) => m.id !== entry.id));
    writeCollection(
      'assignments',
      listAssignments().filter((a) => !(a.source.kind === 'harness' && a.source.harnessModelId === entry.id)),
    );
    return { ok: true };
  })
  .get('/api/assignments', () => listAssignments())
  .post('/api/assignments', (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const sourceRaw = record(body.source, 'source');
    const kind = sourceRaw.kind;
    let source: Assignment['source'];
    let baseLabel: string;
    if (kind === 'api') {
      const model = requireModel(str(sourceRaw.modelEntryId, 'Model', 80));
      const provider = requireProvider(model.providerId);
      baseLabel = model.label || provider.label;
      source = { kind: 'api', modelEntryId: model.id };
    } else if (kind === 'harness') {
      const model = requireHarnessModel(str(sourceRaw.harnessModelId, 'Harness model', 80));
      const harness = requireHarness(model.harnessId);
      baseLabel = model.label || harness.label;
      source = { kind: 'harness', harnessModelId: model.id };
    } else {
      throw bad('Assignment source must be an api or harness model.');
    }
    if (
      listAssignments().some(
        (a) =>
          (a.source.kind === 'api' && source.kind === 'api' && a.source.modelEntryId === source.modelEntryId) ||
          (a.source.kind === 'harness' && source.kind === 'harness' && a.source.harnessModelId === source.harnessModelId),
      )
    ) {
      throw bad('That model is already on the team.');
    }
    const aliasInput = optStr(body.alias, 'Alias', 40);
    const assignment: Assignment = {
      id: newId('asg'),
      alias: aliasInput ? (aliasTaken(aliasInput) ? deriveAlias(aliasInput) : aliasInput) : deriveAlias(baseLabel),
      role: pickRole(body.role),
      source,
      enabled: bool(body.enabled, 'Enabled', true),
      createdAt: nowIso(),
    };
    writeCollection('assignments', [...listAssignments(), assignment]);
    return assignment;
  })
  .patch('/api/assignments/:id', (ctx) => {
    const assignment = requireAssignment(ctx.params.id!);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const next: Assignment = { ...assignment };
    if (body.alias !== undefined) {
      const alias = str(body.alias, 'Alias', 40);
      if (aliasTaken(alias, assignment.id)) throw bad('That alias is taken.');
      next.alias = alias;
    }
    if (body.role !== undefined) next.role = pickRole(body.role);
    if (body.enabled !== undefined) next.enabled = bool(body.enabled, 'Enabled', assignment.enabled);
    writeCollection('assignments', listAssignments().map((a) => (a.id === assignment.id ? next : a)));
    return next;
  })
  .delete('/api/assignments/:id', (ctx) => {
    const assignment = requireAssignment(ctx.params.id!);
    writeCollection('assignments', listAssignments().filter((a) => a.id !== assignment.id));
    const settings = getSettings();
    if (settings.plannerAssignmentId === assignment.id) {
      writeCollection('settings', { ...settings, plannerAssignmentId: undefined, updatedAt: nowIso() });
    }
    return { ok: true };
  })
  .get('/api/settings', () => getSettings())
  .put('/api/settings', (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const current = getSettings();
    const next: Settings = { ...current };
    if (body.concurrency !== undefined) next.concurrency = int(body.concurrency, 'Concurrency', 1, 8, current.concurrency);
    if (body.autoReview !== undefined) next.autoReview = bool(body.autoReview, 'Auto review', current.autoReview);
    if (body.theme !== undefined) {
      if (body.theme !== 'paper' && body.theme !== 'ink') throw bad('Theme must be paper or ink.');
      next.theme = body.theme;
    }
    if (body.workspaceRoot !== undefined) {
      const workspace = resolveWorkspace(str(body.workspaceRoot, 'Workspace', 600));
      if (!workspace.ok) throw bad(workspace.message ?? 'Workspace is not usable.');
      next.workspaceRoot = workspace.path;
    }
    if (body.plannerAssignmentId !== undefined) {
      const id = optStr(body.plannerAssignmentId, 'Planner', 80);
      if (id) {
        requireAssignment(id);
        next.plannerAssignmentId = id;
      } else {
        next.plannerAssignmentId = undefined;
      }
    }
    if (body.activeProjectId !== undefined) {
      const id = optStr(body.activeProjectId, 'Project', 80);
      if (id) {
        const project = getProject(id);
        if (!project) throw bad('That project folder is not saved any more.');
        next.activeProjectId = project.id;
        next.workspaceRoot = project.path;
      } else {
        next.activeProjectId = undefined;
      }
    }
    next.updatedAt = nowIso();
    writeCollection('settings', next);
    return next;
  })
  .get('/api/runs', (ctx) => {
    const limit = int(ctx.url.searchParams.get('limit') ?? undefined, 'limit', 1, 200, 50);
    return listRuns(limit);
  })
  .post('/api/runs', async (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const prompt = str(body.prompt, 'Prompt', 20_000);
    const settings = getSettings();
    const requested = optStr(body.workspace, 'Workspace', 600) ?? settings.workspaceRoot;
    const workspace = resolveWorkspace(requested);
    if (!workspace.ok) throw bad(workspace.message ?? 'Workspace is not usable.');
    return startRun({ prompt, workspace: workspace.path });
  })
  .get('/api/runs/:id', (ctx) => {
    const run = readRun(ctx.params.id!);
    if (!run) throw notFound('Run');
    return { run, tasks: readTasks(run.id) };
  })
  .post('/api/runs/:id/cancel', (ctx) => {
    const run = readRun(ctx.params.id!);
    if (!run) throw notFound('Run');
    return { ok: cancelRun(run.id) };
  })
  .get('/api/runs/:id/events', (ctx) => {
    const run = readRun(ctx.params.id!);
    if (!run) throw notFound('Run');
    const since = int(ctx.url.searchParams.get('since') ?? undefined, 'since', 0, 1_000_000, 0);
    return readEvents(run.id, since);
  })
  .delete('/api/runs/:id', (ctx) => {
    const run = readRun(ctx.params.id!);
    if (!run) throw notFound('Run');
    deleteRun(run.id);
    return { ok: true };
  })
  .get('/api/fs', (ctx) => {
    const target = ctx.url.searchParams.get('path') ?? getSettings().workspaceRoot;
    const showHidden = ctx.url.searchParams.get('hidden') === '1';
    return listDirectories(target, showHidden);
  })
  .get('/api/fs/places', () => ({ home: commonPlaces() }))
  .get('/api/projects', () => listProjects())
  .post('/api/projects', (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const workspace = resolveWorkspace(str(body.path, 'Folder', 600));
    if (!workspace.ok) throw bad(workspace.message ?? 'That folder cannot be used.');
    const existing = listProjects().find((project) => project.path === workspace.path);
    if (existing) return existing;
    const label = optStr(body.label, 'Label', 80) ?? workspace.path.split('/').filter(Boolean).pop() ?? workspace.path;
    const project: ProjectRecord = {
      id: newId('prj'),
      label,
      path: workspace.path,
      createdAt: nowIso(),
    };
    writeProjects([...listProjects(), project]);
    return project;
  })
  .patch('/api/projects/:id', (ctx) => {
    const project = listProjects().find((item) => item.id === ctx.params.id);
    if (!project) throw notFound('Project');
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const next: ProjectRecord = { ...project };
    if (body.label !== undefined) next.label = str(body.label, 'Label', 80);
    if (body.path !== undefined) {
      const workspace = resolveWorkspace(str(body.path, 'Folder', 600));
      if (!workspace.ok) throw bad(workspace.message ?? 'That folder cannot be used.');
      next.path = workspace.path;
    }
    writeProjects(listProjects().map((item) => (item.id === project.id ? next : item)));
    return next;
  })
  .delete('/api/projects/:id', (ctx) => {
    const project = listProjects().find((item) => item.id === ctx.params.id);
    if (!project) throw notFound('Project');
    writeProjects(listProjects().filter((item) => item.id !== project.id));
    const settings = getSettings();
    if (settings.activeProjectId === project.id) {
      const { activeProjectId: _dropped, ...rest } = settings;
      writeCollection('settings', { ...rest, updatedAt: nowIso() } as unknown as Settings);
    }
    return { ok: true };
  });

export type { Ctx };
