import type { Assignment, HarnessModel, HarnessRecord, ModelEntry, ProviderRecord, TeamRole } from '../types.js';
import { listAssignments, listHarnessModels, listHarnesses, listModels, listProviders, providerSecret } from '../store/index.js';

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

export interface ApiMember extends TeamMemberView {
  kind: 'api';
  provider: ProviderRecord;
  model: ModelEntry;
  apiKey?: string;
}

export interface HarnessMember extends TeamMemberView {
  kind: 'harness';
  harness: HarnessRecord;
  model: HarnessModel;
}

export type Member = ApiMember | HarnessMember;

interface Resolved {
  assignment: Assignment;
  providerLabel: string;
  modelId: string;
  contextHint?: number;
  provider?: ProviderRecord;
  model?: ModelEntry;
  harness?: HarnessRecord;
  harnessModel?: HarnessModel;
}

function resolve(assignment: Assignment): Resolved | null {
  const source = assignment.source;
  if (source.kind === 'api') {
    const model = listModels().find((m) => m.id === source.modelEntryId);
    if (!model) return null;
    const provider = listProviders().find((p) => p.id === model.providerId);
    if (!provider) return null;
    return {
      assignment,
      providerLabel: provider.label,
      modelId: model.modelId,
      contextHint: model.contextHint,
      provider,
      model,
    };
  }
  const harnessModel = listHarnessModels().find((m) => m.id === source.harnessModelId);
  if (!harnessModel) return null;
  const harness = listHarnesses().find((h) => h.id === harnessModel.harnessId);
  if (!harness) return null;
  return {
    assignment,
    providerLabel: harness.label,
    modelId: harnessModel.modelId,
    harness,
    harnessModel,
  };
}

export function resolveMembers(): Member[] {
  const out: Member[] = [];
  for (const assignment of listAssignments()) {
    const resolved = resolve(assignment);
    if (!resolved) continue;
    const base: TeamMemberView = {
      id: assignment.id,
      alias: assignment.alias,
      role: assignment.role,
      enabled: assignment.enabled,
      kind: assignment.source.kind,
      providerLabel: resolved.providerLabel,
      modelId: resolved.modelId,
      contextHint: resolved.contextHint,
    };
    if (resolved.provider && resolved.model) {
      out.push({
        ...base,
        kind: 'api',
        provider: resolved.provider,
        model: resolved.model,
        apiKey: providerSecret(resolved.provider.id),
      });
    } else if (resolved.harness && resolved.harnessModel) {
      out.push({ ...base, kind: 'harness', harness: resolved.harness, model: resolved.harnessModel });
    }
  }
  return out;
}

export function listTeam(): TeamMemberView[] {
  return resolveMembers().map((member) => ({
    id: member.id,
    alias: member.alias,
    role: member.role,
    enabled: member.enabled,
    kind: member.kind,
    providerLabel: member.providerLabel,
    modelId: member.modelId,
    contextHint: member.contextHint,
  }));
}

export function activeMembers(): Member[] {
  return resolveMembers().filter((member) => member.enabled);
}

export function choosePlanner(members: Member[], preferredId?: string): Member | undefined {
  const onDuty = members.filter((member) => member.enabled);
  if (onDuty.length === 0) return undefined;
  if (preferredId) {
    const preferred = onDuty.find((member) => member.id === preferredId);
    if (preferred) return preferred;
  }
  return onDuty.find((member) => member.role === 'planner') ?? onDuty[0];
}

export function pickAssignee(members: Member[], role: TeamRole, load: Map<string, number>): Member | undefined {
  const onDuty = members.filter((member) => member.enabled);
  if (onDuty.length === 0) return undefined;
  const fits = onDuty.filter((member) => member.role === role);
  const pool = fits.length > 0 ? fits : onDuty.filter((member) => member.role === 'any');
  const candidates = pool.length > 0 ? pool : onDuty;
  return candidates.reduce((best, member) => {
    const bestLoad = load.get(best.id) ?? 0;
    const load_ = load.get(member.id) ?? 0;
    if (load_ !== bestLoad) return load_ < bestLoad ? member : best;
    return member.role === role && best.role !== role ? member : best;
  }, candidates[0]!);
}
