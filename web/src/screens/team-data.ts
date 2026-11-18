import { api } from '../api.js';
import type {
  Assignment,
  DetectionEntry,
  HarnessModel,
  HarnessRecord,
  ModelEntry,
  ProviderRecord,
} from '../api.js';

export interface TeamData {
  providers: ProviderRecord[];
  models: ModelEntry[];
  harnesses: HarnessRecord[];
  harnessModels: HarnessModel[];
  assignments: Assignment[];
  detection: DetectionEntry[];
}

export async function loadTeamData(): Promise<TeamData> {
  const [providers, harnesses, harnessModels, assignments, detection] = await Promise.all([
    api.providers(),
    api.harnesses(),
    api.harnessModels(),
    api.assignments(),
    api.detectHarnesses(),
  ]);
  const modelLists = await Promise.all(providers.map((provider) => api.models(provider.id)));
  return { providers, models: modelLists.flat(), harnesses, harnessModels, assignments, detection };
}

export function modelsFor(data: TeamData, providerId: string): ModelEntry[] {
  return data.models.filter((model) => model.providerId === providerId);
}

export function harnessModelsFor(data: TeamData, harnessId: string): HarnessModel[] {
  return data.harnessModels.filter((model) => model.harnessId === harnessId);
}

export function assignmentForApiModel(data: TeamData, modelId: string): Assignment | undefined {
  return data.assignments.find((item) => item.source.kind === 'api' && item.source.modelEntryId === modelId);
}

export function assignmentForHarnessModel(data: TeamData, modelId: string): Assignment | undefined {
  return data.assignments.find((item) => item.source.kind === 'harness' && item.source.harnessModelId === modelId);
}

export function suggestAlias(prefix: string, existing: Assignment[]): string {
  const normalized = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = normalized.slice(0, 24) || 'member';
  const taken = new Set(existing.map((item) => item.alias));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function sourceLabel(data: TeamData, assignment: Assignment): string {
  const source = assignment.source;
  if (source.kind === 'api') {
    const model = data.models.find((item) => item.id === source.modelEntryId);
    if (!model) return 'Model removed';
    const provider = data.providers.find((item) => item.id === model.providerId);
    return provider ? `${provider.label} / ${model.modelId}` : model.modelId;
  }
  const model = data.harnessModels.find((item) => item.id === source.harnessModelId);
  if (!model) return 'Harness model removed';
  const harness = data.harnesses.find((item) => item.id === model.harnessId);
  return harness ? `${harness.label} / ${model.modelId}` : model.modelId;
}
