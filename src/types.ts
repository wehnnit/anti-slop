export type Id = string;

export type ProviderFlavor = "openai" | "anthropic";

export type HarnessKind =
  | "codex"
  | "claude"
  | "opencode"
  | "hermes"
  | "cursor"
  | "deepai"
  | "custom";

// How a harness takes work. Headless CLIs read one prompt and print one answer,
// so they can be handed a task and left alone. Session apps open a window you
// then talk to, so the most Anti-Slop can do is open them on the right folder.
export type HarnessMode = "headless" | "session";

export type TeamRole = "planner" | "builder" | "reviewer" | "any";

export interface ProviderRecord {
  id: Id;
  label: string;
  baseUrl: string;
  flavor: ProviderFlavor;
  builtinId?: string;
  headers: Record<string, string>;
  hasKey: boolean;
  createdAt: string;
}

export interface ModelEntry {
  id: Id;
  providerId: Id;
  modelId: string;
  label: string;
  contextHint?: number;
  enabled: boolean;
  createdAt: string;
}

export interface HarnessRecord {
  id: Id;
  kind: HarnessKind;
  label: string;
  command: string;
  argsTemplate?: string;
  version?: string;
  mode?: HarnessMode;
  // Where on this Mac the harness was found, kept so the dashboard can say so.
  location?: string;
  createdAt: string;
}

export interface HarnessModel {
  id: Id;
  harnessId: Id;
  modelId: string;
  label: string;
  enabled: boolean;
  createdAt: string;
}

export type AssignmentSource =
  | { kind: "api"; modelEntryId: Id }
  | { kind: "harness"; harnessModelId: Id };

export interface Assignment {
  id: Id;
  alias: string;
  role: TeamRole;
  source: AssignmentSource;
  enabled: boolean;
  createdAt: string;
}

// A folder on this Mac that the team is allowed to work in. These live in the
// support folder's data directory, never inside the project itself.
export interface ProjectRecord {
  id: Id;
  label: string;
  path: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface Settings {
  plannerAssignmentId?: Id;
  concurrency: number;
  autoReview: boolean;
  workspaceRoot: string;
  activeProjectId?: Id;
  theme: "paper" | "ink";
  updatedAt: string;
}

export type RunStatus =
  | "queued"
  | "planning"
  | "running"
  | "reviewing"
  | "done"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "pending"
  | "blocked"
  | "assigned"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export interface PlanTask {
  key: string;
  title: string;
  brief: string;
  acceptance: string[];
  role: TeamRole;
  dependsOn: string[];
}

export interface TaskRecord {
  id: Id;
  runId: Id;
  key: string;
  title: string;
  brief: string;
  acceptance: string[];
  role: TeamRole;
  dependsOn: string[];
  assigneeId?: Id;
  assigneeLabel?: string;
  status: TaskStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  output?: string;
  error?: string;
}

export interface RunStats {
  tasks: number;
  done: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  ms: number;
}

export interface RunRecord {
  id: Id;
  prompt: string;
  workspace: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  stats: RunStats;
}

export type RunEventType =
  | "run.status"
  | "plan.ready"
  | "task.status"
  | "task.delta"
  | "task.log"
  | "run.log"
  | "run.done";

export interface RunEvent {
  seq: number;
  at: string;
  runId: Id;
  taskId?: Id;
  type: RunEventType;
  status?: string;
  text?: string;
  payload?: unknown;
}

export interface CompletionUsage {
  tokensIn?: number;
  tokensOut?: number;
}

export interface CompletionRequest {
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export type CompletionChunk =
  | { type: "text"; text: string }
  | { type: "usage"; usage: CompletionUsage };

export interface HarnessDetectResult {
  kind: HarnessKind;
  label: string;
  installed: boolean;
  command: string;
  version?: string;
}

export interface HarnessRunRequest {
  prompt: string;
  model?: string;
  cwd: string;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}

export interface HarnessRunResult {
  text: string;
  exitCode: number;
  stderr: string;
}

export interface DetectionEntry {
  kind: HarnessKind;
  label: string;
  installed: boolean;
  command: string;
  version?: string;
  // Absolute path when the harness was found somewhere off PATH.
  location?: string;
  mode: HarnessMode;
  // Plain-language note about anything the user should know before authorizing.
  note?: string;
  suggestedModels: string[];
}
