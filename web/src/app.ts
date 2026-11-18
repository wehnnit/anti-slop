import { api } from './api.js';
import { clear, h, mount, svg, toast } from './ui.js';
import { render as renderTeam } from './screens/team.js';
import { render as renderToday } from './screens/today.js';
import { render as renderRuns } from './screens/runs.js';
import { render as renderRunDetail } from './screens/run-detail.js';
import { render as renderSettings } from './screens/settings.js';

export interface ScreenContext {
  mount: HTMLElement;
  param?: string;
  refresh(): void;
  go(route: string): void;
}

type Renderer = (ctx: ScreenContext) => void | (() => void);

interface Route {
  path: string;
  nav: string;
  render: Renderer;
}

const routes: Route[] = [
  { path: '/', nav: 'today', render: renderToday },
  { path: '/team', nav: 'team', render: renderTeam },
  { path: '/runs', nav: 'runs', render: renderRuns },
  { path: '/settings', nav: 'settings', render: renderSettings },
];

const navItems = [
  { href: '#/', key: 'today', label: 'Today' },
  { href: '#/team', key: 'team', label: 'Team' },
  { href: '#/runs', key: 'runs', label: 'Runs' },
  { href: '#/settings', key: 'settings', label: 'Settings' },
];

function resolveRoute(path: string): { match: Route; param?: string } {
  const detail = path.match(/^\/runs\/([^/]+)$/);
  if (detail?.[1]) {
    return { match: { path: '/runs/:id', nav: 'runs', render: renderRunDetail }, param: detail[1] };
  }
  const found = routes.find((route) => route.path === path);
  return { match: found ?? routes[0]!, param: undefined };
}

function brandMark(): SVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 32 32', 'aria-hidden': 'true' },
    svg('rect', { x: '1', y: '1', width: '30', height: '30', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' }),
    svg('rect', { x: '7', y: '7', width: '18', height: '18', fill: 'currentColor' }),
    svg('path', { d: 'M7 25 L25 7', stroke: 'var(--accent)', 'stroke-width': '3' }),
  );
}

export function start(): void {
  const root = document.getElementById('root');
  if (!root) return;

  const outlet = h('div', { class: 'main' });
  const navLinks = new Map<string, HTMLAnchorElement>();
  const themeButton = h('button', {
    class: 'btn btn--ghost btn--sm',
    type: 'button',
    text: 'Ink',
    'aria-label': 'Switch between paper and ink theme',
    'on:click': () => toggleTheme(),
  });

  const nav = h('nav', { class: 'nav', 'aria-label': 'Primary' });
  for (const item of navItems) {
    const link = h('a', { href: item.href, text: item.label });
    navLinks.set(item.key, link);
    nav.appendChild(link);
  }

  const versionTag = h('span', { class: 'micro', text: `v${window.__ANTI_SL__?.version ?? '0.0.0'}` });

  mount(
    root,
    h(
      'div',
      { class: 'shell' },
      h(
        'header',
        { class: 'topbar' },
        h('a', { class: 'brand', href: '#/' }, brandMark(), h('b', { text: 'Anti-Slop' })),
        nav,
        h('div', { class: 'topbar-tail' }, versionTag, themeButton),
      ),
      outlet,
    ),
  );

  let teardown: (() => void) | void;
  let currentPath = '';
  let theme: 'paper' | 'ink' = 'paper';

  function applyTheme(next: 'paper' | 'ink'): void {
    theme = next;
    document.documentElement.dataset['theme'] = next;
    themeButton.textContent = next === 'paper' ? 'Ink' : 'Paper';
  }

  function toggleTheme(): void {
    const next = theme === 'paper' ? 'ink' : 'paper';
    applyTheme(next);
    api.saveSettings({ theme: next }).catch(() => undefined);
  }

  function navigate(): void {
    const path = location.hash.replace(/^#/, '') || '/';
    if (path === currentPath) return;
    currentPath = path;
    const { match, param } = resolveRoute(path);
    const activeNav = param ? 'runs' : match.nav;
    for (const [key, link] of navLinks) {
      if (key === activeNav) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (typeof teardown === 'function') {
      try {
        teardown();
      } catch {
        /* a failed teardown must not block navigation */
      }
    }
    teardown = undefined;
    clear(outlet);
    const host = h('div', { class: 'route-host' });
    outlet.appendChild(host);
    window.scrollTo({ top: 0 });
    const ctx: ScreenContext = {
      mount: host,
      param,
      refresh: () => navigate(),
      go: (route: string) => {
        location.hash = route;
      },
    };
    try {
      teardown = match.render(ctx);
    } catch (err) {
      console.error(err);
      mount(
        host,
        h(
          'div',
          { class: 'empty-state' },
          h('h3', { text: 'This screen failed to load.' }),
          h('p', { text: err instanceof Error ? err.message : String(err) }),
        ),
      );
    }
  }

  window.addEventListener('hashchange', navigate);

  api
    .settings()
    .then((settings) => applyTheme(settings.theme === 'ink' ? 'ink' : 'paper'))
    .catch(() => applyTheme('paper'))
    .finally(navigate);

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason as { message?: string } | undefined;
    toast(reason?.message ?? 'Something went wrong.', 'error');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
