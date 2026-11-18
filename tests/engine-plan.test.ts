import { describe, expect, it } from 'vitest';
import { fallbackPlan, orderByDependency, parsePlan } from '../src/engine/planner.js';
import { allSettled, markBlocked, nextBatch, readyTasks } from '../src/engine/scheduler.js';
import type { PlanTask, TaskRecord } from '../src/types.js';

function planJson(tasks: unknown[]): string {
  return JSON.stringify(tasks);
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'tsk_1',
    runId: 'run_1',
    key: 'one',
    title: 'One',
    brief: 'Do one thing',
    acceptance: ['It is done'],
    role: 'builder',
    dependsOn: [],
    status: 'pending',
    attempts: 0,
    ...overrides,
  };
}

describe('parsePlan', () => {
  it('coerces a well-formed plan and derives keys from position and title', () => {
    const tasks = parsePlan(
      planJson([{ title: 'Survey the repo', brief: 'Read files', acceptance: ['Notes exist'], role: 'builder', dependsOn: [] }]),
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      key: '1-survey-the-repo',
      title: 'Survey the repo',
      brief: 'Read files',
      acceptance: ['Notes exist'],
      role: 'builder',
      dependsOn: [],
    });
  });

  it('produces the same keys for the same plan twice', () => {
    const raw = planJson([
      { title: 'First: read', role: 'builder' },
      { title: 'Second', role: 'reviewer' },
    ]);

    expect(parsePlan(raw).map((t) => t.key)).toEqual(parsePlan(raw).map((t) => t.key));
    expect(parsePlan(raw).map((t) => t.key)).toEqual(['1-first-read', '2-second']);
  });

  it('falls back to a positional key when a title has no usable characters', () => {
    const tasks = parsePlan(planJson([{ title: '---', brief: 'x' }]));
    expect(tasks[0]!.key).toBe('task-1');
  });

  it('maps an unknown role to any', () => {
    const tasks = parsePlan(planJson([{ title: 'Ship it', role: 'wizard' }]));
    expect(tasks[0]!.role).toBe('any');
  });

  it('keeps an empty acceptance list empty rather than inventing criteria', () => {
    const tasks = parsePlan(planJson([{ title: 'Ship it' }]));
    expect(tasks[0]!.acceptance).toEqual([]);
  });

  it('falls back to the title when the brief is missing', () => {
    const tasks = parsePlan(planJson([{ title: 'Ship it' }]));
    expect(tasks[0]!.brief).toBe('Ship it');
  });

  it('drops dependencies on titles that are not in the plan', () => {
    const tasks = parsePlan(
      planJson([
        { title: 'Alpha', dependsOn: ['Ghost task'] },
        { title: 'Beta', dependsOn: ['Alpha', 'Alpha'] },
      ]),
    );

    expect(tasks.find((t) => t.title === 'Alpha')!.dependsOn).toEqual([]);
    expect(tasks.find((t) => t.title === 'Beta')!.dependsOn).toEqual(['1-alpha']);
  });

  it('ignores a task that depends on itself', () => {
    const tasks = parsePlan(planJson([{ title: 'Loop', dependsOn: ['Loop'] }]));
    expect(tasks[0]!.dependsOn).toEqual([]);
  });

  it('orders the output so dependencies come first', () => {
    const tasks = parsePlan(
      planJson([
        { title: 'Review', dependsOn: ['Build'] },
        { title: 'Build', dependsOn: ['Survey'] },
        { title: 'Survey' },
      ]),
    );

    expect(tasks.map((t) => t.title)).toEqual(['Survey', 'Build', 'Review']);
  });

  it('keeps a cyclic plan instead of failing and breaks the cycle', () => {
    const tasks = parsePlan(
      planJson([
        { title: 'Left', dependsOn: ['Right'] },
        { title: 'Right', dependsOn: ['Left'] },
      ]),
    );

    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.title).sort()).toEqual(['Left', 'Right']);
    expect(tasks.every((t) => t.dependsOn.length === 0)).toBe(true);
  });

  it('caps the plan at eight tasks', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ title: `Task ${index + 1}` }));
    const tasks = parsePlan(planJson(many));
    expect(tasks).toHaveLength(8);
    expect(tasks.map((t) => t.title)).toEqual(['Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5', 'Task 6', 'Task 7', 'Task 8']);
  });

  it('rejects an empty plan without inventing tasks', () => {
    expect(() => parsePlan('[]')).toThrow('The planner returned no tasks.');
  });

  it('keeps every task and never leaves a dependency pointing forward after a cycle', () => {
    const tasks = parsePlan(
      planJson([
        { title: 'Wave', dependsOn: ['Ripple'] },
        { title: 'Ripple', dependsOn: ['Wave'] },
        { title: 'Shore', dependsOn: ['Ripple'] },
      ]),
    );

    expect(tasks).toHaveLength(3);
    const seen = new Set<string>();
    for (const item of tasks) {
      for (const dep of item.dependsOn) expect(seen.has(dep)).toBe(true);
      seen.add(item.key);
    }
  });

  it('rejects output that carries no array at all', () => {
    expect(() => parsePlan('I would rather not.')).toThrow('The planner did not return JSON.');
  });

  it('reads a plan wrapped in prose and a code fence', () => {
    const raw = [
      'Here is the plan.',
      '```json',
      planJson([{ title: 'Survey', role: 'builder' }, { title: 'Build', dependsOn: ['Survey'] }]),
      '```',
      'That is all.',
    ].join('\n');

    const tasks = parsePlan(raw);
    expect(tasks.map((t) => t.title)).toEqual(['Survey', 'Build']);
    expect(tasks[1]!.dependsOn).toEqual(['1-survey']);
  });

  it('trims stray whitespace and ignores blank dependency names', () => {
    const tasks = parsePlan(planJson([{ title: '  Survey  ', dependsOn: ['  ', ''] }]));
    expect(tasks[0]!.title).toBe('Survey');
    expect(tasks[0]!.dependsOn).toEqual([]);
  });
});

describe('orderByDependency', () => {
  const base: PlanTask = { key: 'a', title: 'A', brief: 'a', acceptance: [], role: 'any', dependsOn: [] };

  it('leaves an already ordered list alone', () => {
    const ordered = [base, { ...base, key: 'b', title: 'B', dependsOn: ['a'] }];
    expect(orderByDependency(ordered).map((t) => t.key)).toEqual(['a', 'b']);
  });

  it('returns every task once even when keys are duplicated', () => {
    const tasks = [base, { ...base, title: 'B' }];
    const result = orderByDependency(tasks);
    expect(result).toHaveLength(1);
  });

  it('does not lose a task whose dependency points at a missing key', () => {
    const tasks = [base, { ...base, key: 'c', title: 'C', dependsOn: ['ghost'] }];
    expect(orderByDependency(tasks).map((t) => t.key).sort()).toEqual(['a', 'c']);
  });
});

describe('fallbackPlan', () => {
  it('always produces a usable three-step plan', () => {
    const tasks = fallbackPlan('Replace the release script with a shell one');

    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.key)).toEqual(['1-survey', '2-implement', '3-review']);
    expect(tasks.map((t) => t.role)).toEqual(['builder', 'builder', 'reviewer']);
    expect(tasks[1]!.dependsOn).toEqual([tasks[0]!.key]);
    expect(tasks[2]!.dependsOn).toEqual([tasks[1]!.key]);
    for (const item of tasks) {
      expect(item.key.length).toBeGreaterThan(0);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.acceptance.length).toBeGreaterThan(0);
    }
  });

  it('carries the request into the brief and shortens a long title', () => {
    const prompt = 'Update the release notes and the changelog generator so it lists every merged pull request by title';
    const tasks = fallbackPlan(prompt);

    expect(tasks[1]!.brief).toContain(prompt);
    expect(tasks[1]!.title.length).toBeLessThanOrEqual(64);
  });

  it('keeps a short title for a short request', () => {
    expect(fallbackPlan('fix the typo').at(1)!.title).toBe('fix the typo');
  });

  it('is deterministic for the same input', () => {
    expect(fallbackPlan('same brief')).toEqual(fallbackPlan('same brief'));
  });
});

describe('scheduler', () => {
  it('offers only tasks whose dependencies are done', () => {
    const tasks = [
      task({ id: 'tsk_a', key: 'a', status: 'done' }),
      task({ id: 'tsk_b', key: 'b', dependsOn: ['a'] }),
      task({ id: 'tsk_c', key: 'c', dependsOn: ['b'] }),
    ];

    expect(readyTasks(tasks, new Set()).map((t) => t.key)).toEqual(['b']);
  });

  it('never offers a task that is already running', () => {
    const tasks = [task({ id: 'tsk_a', key: 'a' })];
    expect(readyTasks(tasks, new Set(['tsk_a']))).toEqual([]);
  });

  it('limits a batch to the free slots', () => {
    const tasks = [task({ id: 'tsk_a', key: 'a' }), task({ id: 'tsk_b', key: 'b' }), task({ id: 'tsk_c', key: 'c' })];

    expect(nextBatch(tasks, new Set(), 3)).toHaveLength(3);
    expect(nextBatch(tasks, new Set(['tsk_x']), 2)).toHaveLength(1);
    expect(nextBatch(tasks, new Set(), 0)).toEqual([]);
  });

  it('skips a task whose dependency failed and blocks a task still waiting', () => {
    const tasks = [
      task({ id: 'tsk_a', key: 'a', status: 'failed' }),
      task({ id: 'tsk_b', key: 'b', dependsOn: ['a'] }),
      task({ id: 'tsk_c', key: 'c', dependsOn: ['b'] }),
    ];

    const marked = markBlocked(tasks);
    expect(marked.find((t) => t.key === 'b')!.status).toBe('skipped');
    expect(marked.find((t) => t.key === 'b')!.error).toMatch(/depends on/i);
    expect(marked.find((t) => t.key === 'c')!.status).toBe('blocked');
  });

  it('promotes a blocked task once its dependency is done', () => {
    const tasks = [task({ id: 'tsk_a', key: 'a', status: 'done' }), task({ id: 'tsk_b', key: 'b', dependsOn: ['a'], status: 'blocked' })];
    expect(markBlocked(tasks).find((t) => t.key === 'b')!.status).toBe('pending');
  });

  it('does not touch a task that already finished', () => {
    const tasks = [task({ id: 'tsk_a', key: 'a', status: 'done', dependsOn: ['gone'] })];
    expect(markBlocked(tasks)[0]!.status).toBe('done');
  });

  it('reports settled only when every task is terminal', () => {
    expect(allSettled([task({ status: 'done' }), task({ status: 'skipped' }), task({ status: 'failed' })])).toBe(true);
    expect(allSettled([task({ status: 'done' }), task({ status: 'running' })])).toBe(false);
    expect(allSettled([])).toBe(true);
  });
});
