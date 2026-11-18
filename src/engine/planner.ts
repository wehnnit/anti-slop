import type { CompletionRequest, PlanTask, TeamRole } from '../types.js';
import { runHarness } from '../harnesses/run.js';
import { complete } from '../providers/index.js';
import type { Member } from './team.js';

const MAX_TASKS = 8;
const VALID_ROLES: TeamRole[] = ['planner', 'builder', 'reviewer', 'any'];

const SYSTEM = [
  'You are the planner inside a small local coding tool.',
  'Split the brief into the fewest self-contained tasks that a single worker can finish without asking follow-up questions.',
  'Reply with JSON only: an array of objects with keys "title", "brief", "acceptance", "role", "dependsOn".',
  'title is under 60 characters. brief is one paragraph written as an instruction to the worker.',
  'acceptance is an array of concrete checks. role is one of planner, builder, reviewer, any.',
  'dependsOn lists the titles this task needs first. Never create cycles. Return between 1 and 8 tasks.',
].join(' ');

export interface PlanResult {
  tasks: PlanTask[];
  tokensIn: number;
  tokensOut: number;
}

function normaliseKey(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug ? `${index + 1}-${slug}` : `task-${index + 1}`;
}

function coerceRole(value: unknown): TeamRole {
  return typeof value === 'string' && (VALID_ROLES as string[]).includes(value) ? (value as TeamRole) : 'any';
}

function coerceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

export function parsePlan(raw: string): PlanTask[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  const slice = start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!fenced?.[1]) throw new Error('The planner did not return JSON.');
    parsed = JSON.parse(fenced[1].slice(fenced[1].indexOf('['), fenced[1].lastIndexOf(']') + 1));
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('The planner returned no tasks.');

  const entries = parsed.slice(0, MAX_TASKS) as Record<string, unknown>[];
  const titles = entries.map((entry, index) => String(entry['title'] ?? `Task ${index + 1}`).trim());

  const tasks: PlanTask[] = entries.map((entry, index) => {
    const title = titles[index]!;
    const rawDeps = coerceList(entry['dependsOn']);
    const deps: string[] = [];
    for (const dep of rawDeps) {
      const matchIndex = titles.findIndex((t) => t.toLowerCase() === dep.toLowerCase());
      if (matchIndex === -1 || matchIndex === index) continue;
      const key = normaliseKey(titles[matchIndex]!, matchIndex);
      if (!deps.includes(key)) deps.push(key);
    }
    return {
      key: normaliseKey(title, index),
      title,
      brief: String(entry['brief'] ?? title).trim(),
      acceptance: coerceList(entry['acceptance']),
      role: coerceRole(entry['role']),
      dependsOn: deps,
    };
  });

  return orderByDependency(tasks);
}

export function orderByDependency(tasks: PlanTask[]): PlanTask[] {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const placed = new Set<string>();
  const out: PlanTask[] = [];

  let guard = 0;
  while (out.length < tasks.length) {
    guard += 1;
    if (guard > tasks.length + 2) break;
    let progressed = false;
    for (const task of tasks) {
      if (placed.has(task.key)) continue;
      const ready = task.dependsOn.every((dep) => !byKey.has(dep) || placed.has(dep));
      if (!ready) continue;
      placed.add(task.key);
      out.push(task);
      progressed = true;
    }
    if (!progressed) {
      for (const task of tasks) {
        if (placed.has(task.key)) continue;
        placed.add(task.key);
        out.push({ ...task, dependsOn: [] });
      }
    }
  }
  return out;
}

export function fallbackPlan(prompt: string): PlanTask[] {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  const head = flat.length > 64 ? `${flat.slice(0, 61)}…` : flat;
  return [
    {
      key: '1-survey',
      title: 'Read the workspace',
      brief: `Inspect the workspace and note the files relevant to this request: ${flat}`,
      acceptance: ['List the files that will change', 'Note any existing convention the change must follow'],
      role: 'builder',
      dependsOn: [],
    },
    {
      key: '2-implement',
      title: head || 'Carry out the request',
      brief: flat,
      acceptance: ['The request is satisfied in code', 'The change follows the conventions already in the workspace'],
      role: 'builder',
      dependsOn: ['1-survey'],
    },
    {
      key: '3-review',
      title: 'Review the change',
      brief: `Review the work done for: ${flat}. Report what is correct, what is missing, and what to fix.`,
      acceptance: ['Every acceptance item is checked', 'Remaining problems are named plainly'],
      role: 'reviewer',
      dependsOn: ['2-implement'],
    },
  ];
}

export async function makePlan(
  prompt: string,
  planner: Member,
  members: Member[],
  signal?: AbortSignal,
): Promise<PlanResult> {
  const roster = members
    .filter((member) => member.enabled)
    .map((member) => `${member.alias} (${member.role})`)
    .join(', ');

  let raw = '';
  let tokensIn = 0;
  let tokensOut = 0;

  const userPrompt = `Team on duty: ${roster || 'a single generalist'}\n\nBrief:\n${prompt}`;

  if (planner.kind === 'harness') {
    const result = await runHarness(planner.harness, {
      prompt: `${SYSTEM}\n\n${userPrompt}`,
      model: planner.model.modelId,
      cwd: process.cwd(),
      signal,
    });
    if (result.exitCode !== 0 && !result.text.trim()) {
      throw new Error(result.stderr.trim() || 'The planner command failed.');
    }
    raw = result.text;
  } else {
    const request: CompletionRequest = {
      baseUrl: planner.provider.baseUrl,
      apiKey: planner.apiKey,
      headers: planner.provider.headers,
      model: planner.model.modelId,
      system: SYSTEM,
      prompt: userPrompt,
      maxTokens: 2000,
      signal,
    };
    for await (const chunk of complete(request, planner.provider.flavor)) {
      if (chunk.type === 'text') raw += chunk.text;
      else {
        tokensIn += chunk.usage.tokensIn ?? 0;
        tokensOut += chunk.usage.tokensOut ?? 0;
      }
    }
  }

  if (!raw.trim()) throw new Error('The planner returned nothing.');
  return { tasks: parsePlan(raw), tokensIn, tokensOut };
}
