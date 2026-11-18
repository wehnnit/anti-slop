import type { TaskRecord } from '../types.js';

export interface SchedulerOptions {
  concurrency: number;
}

export function readyTasks(tasks: TaskRecord[], running: Set<string>): TaskRecord[] {
  const doneKeys = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.key));
  return tasks.filter((task) => {
    if (task.status !== 'pending' && task.status !== 'blocked') return false;
    if (running.has(task.id)) return false;
    return task.dependsOn.every((dep) => doneKeys.has(dep) || !tasks.some((t) => t.key === dep));
  });
}

export function markBlocked(tasks: TaskRecord[]): TaskRecord[] {
  const doneKeys = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.key));
  const deadKeys = new Set(
    tasks.filter((task) => task.status === 'failed' || task.status === 'skipped').map((task) => task.key),
  );
  return tasks.map((task) => {
    if (task.status !== 'pending' && task.status !== 'blocked') return task;
    const deadDep = task.dependsOn.some((dep) => deadKeys.has(dep));
    const waiting = task.dependsOn.some((dep) => !doneKeys.has(dep) && !deadKeys.has(dep));
    if (deadDep) return { ...task, status: 'skipped' as const, error: 'A task it depends on did not finish.' };
    if (waiting) return { ...task, status: 'blocked' as const };
    return task.status === 'blocked' ? { ...task, status: 'pending' as const } : task;
  });
}

export function nextBatch(tasks: TaskRecord[], running: Set<string>, concurrency: number): TaskRecord[] {
  const slots = Math.max(0, concurrency - running.size);
  if (slots === 0) return [];
  return readyTasks(markBlocked(tasks), running).slice(0, slots);
}

export function allSettled(tasks: TaskRecord[]): boolean {
  return tasks.every((task) => task.status === 'done' || task.status === 'failed' || task.status === 'skipped');
}
