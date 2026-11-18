import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

export interface StaticRoots {
  shell: string;
  bundle: string;
  brand: string;
}

function inside(root: string, candidate: string): boolean {
  const base = normalize(root) + sep;
  return normalize(candidate).startsWith(base);
}

export function resolveAsset(roots: StaticRoots, pathname: string): { file: string; type: string } | null {
  const clean = decodeURIComponent(pathname);
  if (clean === '/' || clean === '/index.html') {
    return { file: join(roots.shell, 'index.html'), type: types['.html']! };
  }
  if (clean.startsWith('/app/')) {
    const file = join(roots.bundle, clean.slice('/app/'.length));
    if (!inside(roots.bundle, file) || !existsSync(file)) return null;
    return { file, type: types[extname(file)] ?? 'application/octet-stream' };
  }
  if (clean.startsWith('/brand/')) {
    const file = join(roots.brand, clean.slice('/brand/'.length));
    if (!inside(roots.brand, file) || !existsSync(file)) return null;
    return { file, type: types[extname(file)] ?? 'application/octet-stream' };
  }
  return null;
}

export function streamFile(res: ServerResponse, file: string, type: string): void {
  const stat = statSync(file);
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': type.startsWith('text/html') ? 'no-store' : 'public, max-age=60',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}
