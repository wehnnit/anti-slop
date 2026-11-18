import type { Handler } from './http.js';

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  mutating: boolean;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    const segments = pattern.split('/').filter(Boolean);
    const mutating = method !== 'GET' && method !== 'HEAD';
    this.routes.push({ method, segments, handler, mutating });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: Handler): this {
    return this.add('PUT', pattern, handler);
  }

  patch(pattern: string, handler: Handler): this {
    return this.add('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: Handler): this {
    return this.add('DELETE', pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string>; mutating: boolean } | null {
    const parts = pathname.split('/').filter(Boolean);
    const lookup = method === 'HEAD' ? 'GET' : method;
    for (const route of this.routes) {
      if (route.method !== lookup) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const seg = route.segments[i]!;
        const part = parts[i]!;
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(part);
        } else if (seg !== part) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params, mutating: route.mutating };
    }
    return null;
  }
}
