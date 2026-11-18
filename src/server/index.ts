import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { HttpError, readBody, sendError, sendJson, unauth } from './http.js';
import { router } from './routes.js';
import { resolveAsset, streamFile } from './static.js';
import type { StaticRoots } from './static.js';
import { readEvents, rootPath, VERSION } from '../store/index.js';
import { publish, subscribe } from './bus.js';

export interface ServerOptions {
  port: number;
  host: string;
}

export interface RunningServer {
  server: Server;
  port: number;
  url: string;
  token: string;
  close: () => Promise<void>;
}

function projectRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..');
}

function roots(): StaticRoots {
  const base = projectRoot();
  return {
    shell: join(base, 'web'),
    bundle: join(base, 'web', 'dist'),
    brand: join(base, 'assets', 'brand'),
  };
}

function shellHtml(token: string): string {
  const raw = readFileSync(join(roots().shell, 'index.html'), 'utf8');
  const injected = `<script>window.__ANTI_SL__ = ${JSON.stringify({ token, version: VERSION })};</script>`;
  return raw.replace('<!--anti-sl-boot-->', injected);
}

function originAllowed(req: { headers: Record<string, unknown> }, host: string): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return true;
  try {
    const u = new URL(origin);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === host;
  } catch {
    return false;
  }
}

export async function createDashboardServer(options: Partial<ServerOptions> = {}): Promise<RunningServer> {
  const port = options.port ?? 4321;
  const host = options.host ?? '127.0.0.1';
  const token = randomBytes(24).toString('hex');
  const staticRoots = roots();

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
    const pathname = url.pathname;

    try {
      if (!originAllowed(req as never, host)) throw new HttpError(403, 'forbidden_origin', 'Origin not allowed.');

      if (pathname === '/api/events') {
        await openEventStream(req, res, url);
        return;
      }

      if (pathname.startsWith('/api/')) {
        const match = router.match(method, pathname);
        if (!match) throw new HttpError(404, 'no_route', 'No such endpoint.');
        if (match.mutating && req.headers['x-anti-sl-token'] !== token) throw unauth();
        const body = await readBody(req);
        const result = await match.handler({ req, res, url, params: match.params, body });
        if (res.headersSent) return;
        sendJson(res, method === 'POST' ? 201 : 200, result ?? { ok: true });
        return;
      }

      if (method === 'GET' || method === 'HEAD') {
        if (pathname === '/' || pathname === '/index.html') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(shellHtml(token));
          return;
        }
        const asset = resolveAsset(staticRoots, pathname);
        if (asset) {
          streamFile(res, asset.file, asset.type);
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError && err.status === 404 && !pathname.startsWith('/api/')) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      sendError(res, err);
    }
  });

  async function openEventStream(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    url: URL,
  ) {
    const runFilter = url.searchParams.get('run');
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': stream open\n\n');

    if (runFilter) {
      const backlog = readEvents(runFilter, Number(url.searchParams.get('since') ?? 0));
      for (const ev of backlog) res.write(`event: run-event\ndata: ${JSON.stringify(ev)}\n\n`);
    }

    const unsubscribe = subscribe((ev) => {
      if (runFilter && ev.runId !== runFilter) return;
      res.write(`event: run-event\ndata: ${JSON.stringify(ev)}\n\n`);
    });

    const beat = setInterval(() => res.write(': ping\n\n'), 15_000);

    const close = () => {
      clearInterval(beat);
      unsubscribe();
      res.end();
    };
    req.on('close', close);
    req.on('error', close);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    server,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        setTimeout(resolve, 1500).unref();
      }),
  };
}

export { publish, rootPath, subscribe };
