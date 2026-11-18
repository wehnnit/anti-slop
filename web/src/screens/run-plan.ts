import type { TaskRecord } from '../api.js';
import { el, elapsed, taskStatusCell } from './shared.js';

export function taskRow(task: TaskRecord, index: number, selected: boolean, onSelect: () => void): HTMLElement {
  return el(
    'li',
    { class: `run-task${selected ? ' run-task--selected' : ''}${task.status === 'running' ? ' run-task--live' : ''}` },
    el(
      'button',
      {
        type: 'button',
        class: 'run-task-button',
        'aria-pressed': selected ? 'true' : 'false',
        'on:click': onSelect,
      },
      el('span', { class: 'run-task-index', 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')),
      el(
        'span',
        { class: 'run-task-main' },
        el('span', { class: 'run-task-title' }, task.title),
        el(
          'span',
          { class: 'run-task-meta' },
          taskStatusCell(task.status),
          el('span', { class: 'run-task-assignee' }, task.assigneeLabel ?? 'unassigned'),
          el('span', { class: 'run-task-elapsed' }, elapsed(task.startedAt, task.finishedAt)),
        ),
      ),
    ),
    task.brief ? el('p', { class: 'run-task-brief' }, task.brief) : null,
    task.acceptance.length
      ? el(
          'ul',
          { class: 'run-task-acceptance' },
          ...task.acceptance.map((item) => el('li', null, item)),
        )
      : null,
    task.error ? el('p', { class: 'run-task-error' }, task.error) : null,
  );
}

export function planPlaceholder(): HTMLElement {
  return el(
    'li',
    { class: 'run-plan-empty' },
    'The plan has not landed yet. Tasks appear here as soon as the team finishes splitting the work.',
  );
}

export function metaItem(label: string, value: string): HTMLElement {
  return el('div', { class: 'run-meta-item' }, el('dt', null, label), el('dd', null, value));
}
