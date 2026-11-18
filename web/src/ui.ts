type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

const svgNs = 'http://www.w3.org/2000/svg';

function append(el: Element | DocumentFragment, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      append(el, child as Child[]);
    } else if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  }
}

function applyProps(el: Element, props: Props): void {
  for (const [rawKey, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (rawKey === 'class') {
      el.setAttribute('class', String(value));
      continue;
    }
    if (rawKey === 'text') {
      el.textContent = String(value);
      continue;
    }
    if (rawKey === 'style' && typeof value === 'object') {
      Object.assign((el as HTMLElement).style, value as Record<string, string>);
      continue;
    }
    if (rawKey.startsWith('on:') && typeof value === 'function') {
      el.addEventListener(rawKey.slice(3), value as EventListener);
      continue;
    }
    if (rawKey === 'value' && 'value' in el) {
      (el as HTMLInputElement).value = String(value);
      continue;
    }
    if (rawKey === 'checked' || rawKey === 'disabled' || rawKey === 'hidden') {
      (el as HTMLInputElement)[rawKey] = Boolean(value);
      continue;
    }
    if (rawKey === 'readonly') {
      (el as HTMLInputElement).readOnly = Boolean(value);
      continue;
    }
    if (value === true) {
      el.setAttribute(rawKey, '');
      continue;
    }
    el.setAttribute(rawKey, String(value));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

export function svg(tag: string, props?: Props | null, ...children: Child[]): SVGElement {
  const el = document.createElementNS(svgNs, tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function mount(parent: Element, ...children: Child[]): void {
  clear(parent);
  append(parent, children);
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function clock(iso: string | undefined): string {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--:--' : timeFmt.format(d);
}

export function ago(iso: string | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Date.now() - then;
  if (diff < 45_000) return 'just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return dayFmt.format(new Date(then));
}

export function duration(ms: number | undefined): string {
  if (!ms || ms < 0) return '0s';
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export function statusMark(status: string): HTMLElement {
  return h('span', { class: 'status-mark', 'data-status': status, text: status });
}

let stack: HTMLElement | null = null;

export function toast(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  if (!stack) {
    stack = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(stack);
  }
  const el = h('div', { class: 'toast', 'data-kind': kind, text: message });
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 180ms ease';
    setTimeout(() => el.remove(), 200);
  }, kind === 'error' ? 6000 : 3200);
}

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (value: boolean) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close(false);
    };
    const confirmBtn = h('button', {
      class: `btn ${options.danger ? 'btn--danger' : 'btn--primary'}`,
      type: 'button',
      text: options.confirmLabel ?? 'Confirm',
      'on:click': () => close(true),
    });
    const backdrop = h(
      'div',
      { class: 'dialog-backdrop', role: 'presentation', 'on:click': (ev: Event) => { if (ev.target === backdrop) close(false); } },
      h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title },
        h('h2', { text: options.title }),
        options.body ? h('p', { text: options.body }) : null,
        h(
          'div',
          { class: 'dialog-actions' },
          h('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', 'on:click': () => close(false) }),
          confirmBtn,
        ),
      ),
    );
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey);
    confirmBtn.focus();
  });
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'micro', text: label }),
    input,
    hint ? h('span', { class: 'field-hint', text: hint }) : null,
  );
}

interface EmptyStateOptions {
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}

export function emptyState(options: EmptyStateOptions): HTMLElement {
  return h(
    'div',
    { class: 'empty-state' },
    h('h3', { text: options.title }),
    options.body ? h('p', { text: options.body }) : null,
    options.action
      ? h('button', { class: 'btn btn--primary', type: 'button', text: options.action.label, 'on:click': options.action.onClick })
      : null,
  );
}

export function skeleton(rows = 3): HTMLElement {
  const wrap = h('div', { style: { display: 'grid', gap: '10px' } });
  for (let i = 0; i < rows; i += 1) {
    wrap.appendChild(h('div', { class: 'skeleton', style: { width: `${100 - i * 12}%` } }));
  }
  return wrap;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'ok');
  } catch {
    toast('Could not copy', 'error');
  }
}
