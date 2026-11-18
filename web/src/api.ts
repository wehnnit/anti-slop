import type {
  Assignment,
  DetectionEntry,
  HarnessKind,
  HarnessModel,
  HarnessRecord,
  ModelEntry,
  ProjectRecord,
  ProviderRecord,
  RunEvent,
  RunRecord,
  RunStatus,
  Settings,
  TaskRecord,
  TaskStatus,
  TeamRole,
} from '../../src/types.js';

export type {
  Assignment,
  DetectionEntry,
  HarnessKind,
  HarnessModel,
  HarnessRecord,
  ModelEntry,
  ProjectRecord,
  ProviderRecord,
  RunEvent,
  RunRecord,
  RunStatus,
  Settings,
  TaskRecord,
  TaskStatus,
  TeamRole,
};

export interface TeamMemberView {
  id: string;
  alias: string;
  role: TeamRole;
  enabled: boolean;
  kind: 'api' | 'harness';
  providerLabel: string;
  modelId: string;
  contextHint?: number;
}

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

export interface TestResult {
  ok: boolean;
  status: number;
  ms: number;
  message: string;
}

export interface DirEntry {
  name: string;
  path: string;
  looksLikeProject: boolean;
}

export interface DirListing {
  path: string;
  parent: string;
  dirs: DirEntry[];
  looksLikeProject: boolean;
  hiddenCount: number;
}

export interface Places {
  home: DirEntry[];
}

declare global {
  interface Window {
    __ANTI_SL__?: { token: string; version: string };
  }
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function token(): string {
  return window.__ANTI_SL__?.token ?? '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-anti-sl-token': token() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'The dashboard server is not responding.');
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const payload = parsed as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'error',
      payload?.error?.message ?? `Request failed with status ${response.status}.`,
    );
  }
  return parsed as T;
}

export const api = {
  overview: () => request<Overview>('GET', '/overview'),
  health: () => request<{ ok: boolean; version: string; root: string }>('GET', '/health'),

  providers: () => request<ProviderRecord[]>('GET', '/providers'),
  createProvider: (body: {
    label: string;
    baseUrl: string;
    flavor: 'openai' | 'anthropic';
    apiKey?: string;
    headers?: Record<string, string>;
    builtinId?: string;
  }) => request<ProviderRecord>('POST', '/providers', body),
  updateProvider: (id: string, body: Partial<{ label: string; baseUrl: string; flavor: 'openai' | 'anthropic'; apiKey: string; headers: Record<string, string> }>) =>
    request<ProviderRecord>('PATCH', `/providers/${id}`, body),
  deleteProvider: (id: string) => request<{ ok: true }>('DELETE', `/providers/${id}`),
  testProvider: (id: string, body: { modelId?: string; apiKey?: string } = {}) =>
    request<TestResult>('POST', `/providers/${id}/test`, body),
  testProviderDraft: (body: {
    baseUrl: string;
    flavor: 'openai' | 'anthropic';
    apiKey?: string;
    modelId?: string;
    headers?: Record<string, string>;
    label?: string;
  }) => request<TestResult>('POST', '/providers/test', body),

  models: (providerId?: string) =>
    providerId ? request<ModelEntry[]>('GET', `/providers/${providerId}/models`) : Promise.resolve([] as ModelEntry[]),
  createModel: (body: { providerId: string; modelId: string; label?: string; contextHint?: number }) =>
    request<ModelEntry>('POST', '/models', body),
  updateModel: (id: string, body: Partial<{ label: string; modelId: string; enabled: boolean; contextHint: number }>) =>
    request<ModelEntry>('PATCH', `/models/${id}`, body),
  deleteModel: (id: string) => request<{ ok: true }>('DELETE', `/models/${id}`),

  detectHarnesses: () => request<DetectionEntry[]>('GET', '/harnesses/detect'),
  harnesses: () => request<HarnessRecord[]>('GET', '/harnesses'),
  createHarness: (body: {
    kind: HarnessKind;
    label: string;
    command: string;
    argsTemplate?: string;
    version?: string;
    mode?: 'headless' | 'session';
    location?: string;
  }) =>
    request<HarnessRecord>('POST', '/harnesses', body),
  updateHarness: (id: string, body: Partial<{ label: string; command: string; argsTemplate: string }>) =>
    request<HarnessRecord>('PATCH', `/harnesses/${id}`, body),
  deleteHarness: (id: string) => request<{ ok: true }>('DELETE', `/harnesses/${id}`),

  harnessModels: () => request<HarnessModel[]>('GET', '/harness-models'),
  createHarnessModel: (body: { harnessId: string; modelId: string; label?: string }) =>
    request<HarnessModel>('POST', '/harness-models', body),
  updateHarnessModel: (id: string, body: Partial<{ label: string; modelId: string; enabled: boolean }>) =>
    request<HarnessModel>('PATCH', `/harness-models/${id}`, body),
  deleteHarnessModel: (id: string) => request<{ ok: true }>('DELETE', `/harness-models/${id}`),

  assignments: () => request<Assignment[]>('GET', '/assignments'),
  createAssignment: (body: { alias?: string; role?: TeamRole; source: Assignment['source']; enabled?: boolean }) =>
    request<Assignment>('POST', '/assignments', body),
  updateAssignment: (id: string, body: Partial<{ alias: string; role: TeamRole; enabled: boolean }>) =>
    request<Assignment>('PATCH', `/assignments/${id}`, body),
  deleteAssignment: (id: string) => request<{ ok: true }>('DELETE', `/assignments/${id}`),

  settings: () => request<Settings>('GET', '/settings'),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/settings', patch),

  runs: (limit = 50) => request<RunRecord[]>('GET', `/runs?limit=${limit}`),
  run: (id: string) => request<{ run: RunRecord; tasks: TaskRecord[] }>('GET', `/runs/${id}`),
  startRun: (body: { prompt: string; workspace?: string }) => request<RunRecord>('POST', '/runs', body),
  cancelRun: (id: string) => request<{ ok: boolean }>('POST', `/runs/${id}/cancel`),
  deleteRun: (id: string) => request<{ ok: true }>('DELETE', `/runs/${id}`),
  events: (id: string, since = 0) => request<RunEvent[]>('GET', `/runs/${id}/events?since=${since}`),

  fs: (path?: string, hidden = false) => {
    const query = new URLSearchParams();
    if (path) query.set('path', path);
    if (hidden) query.set('hidden', '1');
    const suffix = query.toString();
    return request<DirListing>('GET', suffix ? '/fs?' + suffix : '/fs');
  },
  places: () => request<Places>('GET', '/fs/places'),

  projects: () => request<ProjectRecord[]>('GET', '/projects'),
  createProject: (body: { path: string; label?: string }) => request<ProjectRecord>('POST', '/projects', body),
  updateProject: (id: string, body: { label?: string; path?: string }) =>
    request<ProjectRecord>('PATCH', '/projects/' + id, body),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', '/projects/' + id),

  subscribe: (onEvent: (ev: RunEvent) => void): (() => void) => {
    const source = new EventSource('/api/events');
    const handler = (ev: MessageEvent) => {
      try {
        onEvent(JSON.parse(ev.data) as RunEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    source.addEventListener('run-event', handler as EventListener);
    return () => source.close();
  },
};
