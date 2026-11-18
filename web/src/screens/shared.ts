import { h, statusMark, svg } from '../ui.js';
import type { RunStatus, TaskStatus, TeamRole } from '../api.js';

export type { RunStatus, TaskStatus, TeamRole };

export interface ScreenContext {
  mount: HTMLElement;
  param?: string;
  refresh(): void;
  go(route: string): void;
}

type Props = Record<string, unknown>;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  return h(tag, props, ...children) as HTMLElementTagNameMap[K];
}

export function screen(name: string, ...children: Child[]): HTMLElement {
  return el('section', { class: `screen screen--${name}` }, el('div', { class: 'screen-inner' }, ...children));
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return 'The request did not complete.';
}

export function excerpt(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}\u2026`;
}

export function elapsed(startIso?: string, endIso?: string): string {
  if (!startIso) return '--';
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return '--';
  const end = endIso ? Date.parse(endIso) : Date.now();
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function compactNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

export function isLive(status: RunStatus): boolean {
  return status === 'queued' || status === 'planning' || status === 'running' || status === 'reviewing';
}

export function isTerminal(status: RunStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

export function runLabel(status: RunStatus): string {
  const labels: Record<RunStatus, string> = {
    queued: 'Queued',
    planning: 'Planning',
    running: 'Running',
    reviewing: 'Reviewing',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return labels[status] ?? status;
}

export function taskLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    pending: 'Pending',
    blocked: 'Blocked',
    assigned: 'Assigned',
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    skipped: 'Skipped',
  };
  return labels[status] ?? status;
}

export function runStatusCell(status: RunStatus): HTMLElement {
  return el('span', { class: 'fm-status-cell', 'data-label': runLabel(status) }, statusMark(status));
}

export function taskStatusCell(status: TaskStatus): HTMLElement {
  return el('span', { class: 'fm-status-cell', 'data-label': taskLabel(status) }, statusMark(status));
}

export function roleChip(role: TeamRole): HTMLElement {
  return el('span', { class: `fm-role fm-role--${role}` }, role);
}

export function micro(text: string, tone?: 'accent' | 'quiet'): HTMLElement {
  return el('p', { class: `micro fm-micro${tone ? ` fm-micro--${tone}` : ''}` }, text);
}

export function button(
  label: string,
  on: (event: MouseEvent) => void,
  options: { variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit' } = {},
): HTMLButtonElement {
  return el(
    'button',
    {
      type: options.type ?? 'button',
      class: `btn btn--${options.variant ?? 'ghost'}`,
      disabled: options.disabled ?? false,
      'on:click': on,
    },
    label,
  );
}

export function iconButton(
  label: string,
  d: string,
  on: (event: MouseEvent) => void,
  options: { variant?: 'ghost' | 'danger' } = {},
): HTMLButtonElement {
  return el(
    'button',
    {
      type: 'button',
      class: `fm-icon-btn fm-icon-btn--${options.variant ?? 'ghost'}`,
      'aria-label': label,
      title: label,
      'on:click': on,
    },
    icon(d),
  );
}

export function icon(d: string, size = 15): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 16 16',
      width: String(size),
      height: String(size),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.25',
      'stroke-linecap': 'round',
      'aria-hidden': 'true',
    },
    svg('path', { d }),
  );
}

export function input(props: Props = {}): HTMLInputElement {
  return el('input', { type: 'text', class: 'input', spellcheck: 'false', autocomplete: 'off', ...props });
}

export function monoInput(props: Props = {}): HTMLInputElement {
  return el('input', { type: 'text', class: 'input input--mono', spellcheck: 'false', autocomplete: 'off', ...props });
}

export function select(options: Array<{ value: string; label: string }>, props: Props = {}): HTMLSelectElement {
  const control = el(
    'select',
    { class: 'input select', ...props },
    ...options.map((opt) => el('option', { value: opt.value }, opt.label)),
  );
  if (typeof props['value'] === 'string') control.value = props['value'];
  return control;
}

export function callout(kind: 'note' | 'warn' | 'risk', title: string, body: string, action?: HTMLElement): HTMLElement {
  return el(
    'div',
    { class: `fm-callout fm-callout--${kind}` },
    el('span', { class: 'fm-callout-mark', 'aria-hidden': 'true' }, kind === 'note' ? 'i' : kind === 'warn' ? '!' : 'x'),
    el(
      'div',
      { class: 'fm-callout-body' },
      el('p', { class: 'fm-callout-title' }, title),
      el('p', { class: 'fm-callout-text' }, body),
      action ?? null,
    ),
  );
}

export function progressBar(done: number, total: number): HTMLElement {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const fill = el('span', { class: 'fm-progress-fill' });
  fill.style.width = `${Math.round(ratio * 100)}%`;
  return el(
    'span',
    { class: 'fm-progress', role: 'img', 'aria-label': `${done} of ${total} tasks complete` },
    el('span', { class: 'fm-progress-track' }, fill),
    el('span', { class: 'fm-progress-label' }, `${done}/${total}`),
  );
}

export function sectionHead(title: string, meta?: string, aside?: HTMLElement): HTMLElement {
  return el(
    'header',
    { class: 'fm-section-head' },
    el(
      'div',
      { class: 'fm-section-head-text' },
      el('h2', { class: 'fm-section-title' }, title),
      meta ? el('p', { class: 'fm-section-meta' }, meta) : null,
    ),
    aside ?? null,
  );
}

export function failure(err: unknown, retry: () => void): HTMLElement {
  return el(
    'div',
    { class: 'fm-failure', role: 'alert' },
    el('p', { class: 'fm-failure-title' }, 'That request failed'),
    el('p', { class: 'fm-failure-text' }, errorMessage(err)),
    button('Try again', retry),
  );
}

export function linkButton(label: string, onClick: () => void): HTMLButtonElement {
  return el('button', { type: 'button', class: 'fm-link-btn', 'on:click': onClick }, label);
}
